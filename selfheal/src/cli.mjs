import { readFile } from "node:fs/promises";
import { runCommand } from "./runner.mjs";
import { diagnose } from "./diagnose.mjs";
import { applyPatch } from "./patcher.mjs";
import { gatherContext } from "./context.mjs";
import { confirm } from "./prompt.mjs";
import { parseArgs } from "./args.mjs";

const HELP = `selfheal — give any command a self-healing loop, or analyse failures on demand.

USAGE
  selfheal run [options] -- <command> [args...]
  selfheal diagnose [options]      # read failure from --from-file or stdin
  selfheal apply [options] <patch> # apply a unified-diff patch file (or --from-stdin)
  selfheal -- <command> [args...]  # shorthand for 'run'

SHARED OPTIONS
  --json                Emit a single JSON object on stdout (machine-readable)
  --provider <name>     'anthropic' | 'openai' (default: auto-detect from env)
  --model <id>          Override the model id
  --verbose             Log progress to stderr
  -h, --help            Show this help

'run' OPTIONS
  --max-attempts <n>    Max total attempts including the first (default: 3)
  --auto                Apply suggested patches without prompting (default if non-TTY)
  --dry-run             Diagnose only; never modify files
  --context-glob <g>    Extra glob(s) of files to include as context (repeatable)
  --no-git              Don't use git for snapshot/restore (uses .selfheal-backup/)

'diagnose' OPTIONS
  --from-file <path>    Read the failure log from this file (else read stdin)
  --command <str>       The command that failed (for context)
  --exit-code <n>       Exit code of the failed command (default: 1)
  --context-glob <g>    Extra glob(s) of files to include as context (repeatable)
  --no-patch            Ask for diagnosis only, no patch

'apply' OPTIONS
  --from-stdin          Read the patch from stdin instead of a file
  --no-git              Don't use git apply (use GNU patch with backups)

ENV
  ANTHROPIC_API_KEY     Required for --provider anthropic (default model: claude-sonnet-4-5)
  OPENAI_API_KEY        Required for --provider openai    (default model: gpt-4o)
  SELFHEAL_MODEL        Override the default model id

EXAMPLES
  selfheal run --auto -- pnpm test
  pnpm test 2>&1 | selfheal diagnose --command 'pnpm test' --json
  selfheal apply --from-stdin < fix.patch
`;

export async function runCli(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`selfheal: ${err.message}\n`);
    process.exit(2);
  }

  if (opts.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  // Coding-agent ergonomics: when piped (no TTY), default 'run' to --auto
  if (opts.subcommand === "run" && !process.stdin.isTTY && !opts.dryRun) {
    opts.auto = true;
  }

  switch (opts.subcommand) {
    case "run":      return cmdRun(opts);
    case "diagnose": return cmdDiagnose(opts);
    case "apply":    return cmdApply(opts);
    default:
      process.stderr.write(`selfheal: unknown subcommand: ${opts.subcommand}\n`);
      process.exit(2);
  }
}

// ─────────────────────────── run ───────────────────────────

async function cmdRun(opts) {
  if (opts.command.length === 0) {
    process.stderr.write("selfheal run: missing command. Use: selfheal run -- <cmd>\n");
    process.exit(2);
  }
  const provider = resolveProvider(opts.provider);
  if (!provider) return missingProvider(opts);

  let attempt = 0;
  let lastPatch = null;
  const attempts = [];

  while (attempt < opts.maxAttempts) {
    attempt += 1;
    vlog(opts, `── attempt ${attempt}/${opts.maxAttempts} ──`);
    vlog(opts, `$ ${opts.command.join(" ")}`);

    const result = await runCommand(opts.command);
    attempts.push({ attempt, exitCode: result.exitCode });

    if (result.exitCode === 0) {
      return finishRun(opts, { ok: true, attempts, exitCode: 0 });
    }
    if (attempt >= opts.maxAttempts) {
      return finishRun(opts, { ok: false, attempts, exitCode: result.exitCode, reason: "max-attempts" });
    }

    vlog(opts, "Gathering context…");
    const context = await gatherContext({
      command: opts.command, stdout: result.stdout, stderr: result.stderr,
      exitCode: result.exitCode, extraGlobs: opts.contextGlobs,
    });

    vlog(opts, `Diagnosing with ${provider.name} (${provider.model})…`);
    const diag = await diagnose({ provider, context, previous: lastPatch, wantPatch: true });
    attempts[attempts.length - 1].diagnosis = diag.summary;

    if (!opts.json) {
      process.stderr.write("\n── diagnosis ──\n" + diag.summary + "\n");
      if (diag.patch) process.stderr.write("\n── proposed patch ──\n" + diag.patch + "\n");
    }
    if (!diag.patch) {
      return finishRun(opts, { ok: false, attempts, exitCode: result.exitCode, reason: "no-patch-produced", lastDiagnosis: diag });
    }
    if (opts.dryRun) {
      return finishRun(opts, { ok: false, attempts, exitCode: result.exitCode, reason: "dry-run", lastDiagnosis: diag });
    }
    if (!opts.auto && !(await confirm("Apply this patch and retry? [y/N] "))) {
      return finishRun(opts, { ok: false, attempts, exitCode: result.exitCode, reason: "user-aborted", lastDiagnosis: diag });
    }
    try {
      lastPatch = await applyPatch(diag.patch, { useGit: opts.useGit });
      attempts[attempts.length - 1].patchApplied = lastPatch.method;
      vlog(opts, `Patch applied (${lastPatch.method}). Retrying…`);
    } catch (err) {
      return finishRun(opts, { ok: false, attempts, exitCode: result.exitCode, reason: "patch-failed", error: err.message, lastDiagnosis: diag });
    }
  }
}

function finishRun(opts, result) {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ subcommand: "run", ...result }, null, 2) + "\n");
  } else if (result.ok) {
    process.stderr.write(`\n✓ selfheal: succeeded on attempt ${result.attempts.length}/${opts.maxAttempts}\n`);
  } else {
    process.stderr.write(`\n✗ selfheal: failed (${result.reason}) after ${result.attempts.length} attempt(s)\n`);
  }
  process.exit(result.ok ? 0 : (result.exitCode || 1));
}

// ───────────────────────── diagnose ─────────────────────────

async function cmdDiagnose(opts) {
  const provider = resolveProvider(opts.provider);
  if (!provider) return missingProvider(opts);

  const log = opts.fromFile
    ? await readFile(opts.fromFile, "utf8")
    : await readStdin();
  if (!log.trim()) {
    process.stderr.write("selfheal diagnose: no input log provided (stdin empty and no --from-file)\n");
    process.exit(2);
  }

  const command = (opts.commandStr || "<unknown>").split(/\s+/).filter(Boolean);
  const context = await gatherContext({
    command, stdout: "", stderr: log, exitCode: opts.exitCode || 1,
    extraGlobs: opts.contextGlobs,
  });

  vlog(opts, `Diagnosing with ${provider.name} (${provider.model})…`);
  const diag = await diagnose({ provider, context, previous: null, wantPatch: opts.wantPatch });

  const out = {
    subcommand: "diagnose",
    ok: !!diag.patch || !opts.wantPatch,
    summary: diag.summary,
    patch: diag.patch || null,
    files: filesFromPatch(diag.patch),
    model: provider.model,
    provider: provider.name,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write("── diagnosis ──\n" + out.summary + "\n");
    if (out.patch) process.stdout.write("\n── proposed patch ──\n" + out.patch + "\n");
  }
  process.exit(out.ok ? 0 : 1);
}

// ─────────────────────────── apply ──────────────────────────

async function cmdApply(opts) {
  let patch;
  if (opts.fromStdin || (!opts.patchFile && !process.stdin.isTTY)) {
    patch = await readStdin();
  } else if (opts.patchFile) {
    patch = await readFile(opts.patchFile, "utf8");
  } else {
    process.stderr.write("selfheal apply: provide <patch-file> or --from-stdin\n");
    process.exit(2);
  }
  try {
    const info = await applyPatch(patch, { useGit: opts.useGit });
    const out = { subcommand: "apply", ok: true, method: info.method, files: filesFromPatch(patch) };
    if (opts.json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else process.stderr.write(`✓ patch applied (${info.method})\n`);
    process.exit(0);
  } catch (err) {
    const out = { subcommand: "apply", ok: false, error: err.message };
    if (opts.json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else process.stderr.write(`✗ apply failed: ${err.message}\n`);
    process.exit(1);
  }
}

// ─────────────────────────── helpers ────────────────────────

function resolveProvider(explicit) {
  const want = explicit || (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null);
  if (want === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return { name: "anthropic", model: process.env.SELFHEAL_MODEL || "claude-sonnet-4-5", apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (want === "openai" && process.env.OPENAI_API_KEY) {
    return { name: "openai", model: process.env.SELFHEAL_MODEL || "gpt-4o", apiKey: process.env.OPENAI_API_KEY };
  }
  return null;
}

function missingProvider(opts) {
  const msg = "no LLM credentials: set ANTHROPIC_API_KEY or OPENAI_API_KEY";
  if (opts.json) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
  else process.stderr.write(`selfheal: ${msg}\n`);
  process.exit(2);
}

function vlog(opts, msg) {
  if (opts.verbose) process.stderr.write(msg + "\n");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function filesFromPatch(patch) {
  if (!patch) return [];
  const out = new Set();
  for (const line of patch.split("\n")) {
    const m = /^\+\+\+\s+(?:b\/)?(.+?)(?:\s|$)/.exec(line);
    if (m && m[1] !== "/dev/null") out.add(m[1]);
  }
  return [...out];
}
