import { runCommand } from "./runner.mjs";
import { diagnose } from "./diagnose.mjs";
import { applyPatch, revertPatch } from "./patcher.mjs";
import { gatherContext } from "./context.mjs";
import { confirm } from "./prompt.mjs";
import { parseArgs } from "./args.mjs";

const HELP = `selfheal — run a command; on failure, ask an LLM to diagnose and patch, then retry.

USAGE
  selfheal [options] -- <command> [args...]

OPTIONS
  --max-attempts <n>   Max total attempts including the first (default: 3)
  --auto               Apply suggested patches without prompting
  --dry-run            Diagnose only; never modify files
  --provider <name>    'anthropic' | 'openai' (default: auto-detect from env)
  --model <id>         Override the model id
  --context-glob <g>   Extra glob(s) of files to include as context (repeatable)
  --no-git             Don't use git for snapshot/restore (uses .selfheal-backup/)
  --verbose            Print diagnostic details
  -h, --help           Show this help

ENV
  ANTHROPIC_API_KEY    Required for --provider anthropic (default model: claude-sonnet-4-5)
  OPENAI_API_KEY       Required for --provider openai    (default model: gpt-4o)

EXAMPLES
  selfheal -- pnpm test
  selfheal --auto --max-attempts 5 -- python -m pytest -x
  selfheal --context-glob 'src/**/*.ts' -- node build.mjs
`;

export async function runCli(argv) {
  const opts = parseArgs(argv);
  if (opts.help || opts.command.length === 0) {
    process.stdout.write(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const provider = resolveProvider(opts.provider);
  if (!provider) {
    console.error(
      "selfheal: no LLM credentials found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
    );
    process.exit(2);
  }

  let attempt = 0;
  let lastPatchInfo = null;

  while (attempt < opts.maxAttempts) {
    attempt += 1;
    log(opts, `\n── attempt ${attempt}/${opts.maxAttempts} ──`);
    log(opts, `$ ${opts.command.join(" ")}`);

    const result = await runCommand(opts.command);

    if (result.exitCode === 0) {
      console.log(
        `\n✓ selfheal: command succeeded on attempt ${attempt}/${opts.maxAttempts}`
      );
      process.exit(0);
    }

    console.error(
      `\n✗ selfheal: command failed (exit ${result.exitCode}) on attempt ${attempt}/${opts.maxAttempts}`
    );

    if (attempt >= opts.maxAttempts) {
      console.error("selfheal: out of attempts.");
      process.exit(result.exitCode || 1);
    }

    log(opts, "Gathering context for diagnosis…");
    const context = await gatherContext({
      command: opts.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      extraGlobs: opts.contextGlobs,
    });

    log(opts, `Asking ${provider.name} (${provider.model}) to diagnose…`);
    const diag = await diagnose({ provider, context, previous: lastPatchInfo });

    console.log("\n── diagnosis ──");
    console.log(diag.summary);
    if (diag.patch) {
      console.log("\n── proposed patch ──");
      console.log(diag.patch);
    } else {
      console.error("selfheal: model did not produce a patch. Stopping.");
      process.exit(result.exitCode || 1);
    }

    if (opts.dryRun) {
      console.log("\nselfheal: --dry-run, not applying patch.");
      process.exit(result.exitCode || 1);
    }

    if (!opts.auto) {
      const ok = await confirm("Apply this patch and retry? [y/N] ");
      if (!ok) {
        console.log("selfheal: aborted by user.");
        process.exit(result.exitCode || 1);
      }
    }

    try {
      lastPatchInfo = await applyPatch(diag.patch, { useGit: opts.useGit });
      console.log(`selfheal: patch applied (${lastPatchInfo.method}). Retrying…`);
    } catch (err) {
      console.error("selfheal: failed to apply patch:", err.message);
      process.exit(result.exitCode || 1);
    }
  }
}

function resolveProvider(explicit) {
  const want = explicit || (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null);
  if (!want) return null;
  if (want === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    return {
      name: "anthropic",
      model: process.env.SELFHEAL_MODEL || "claude-sonnet-4-5",
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (want === "openai") {
    if (!process.env.OPENAI_API_KEY) return null;
    return {
      name: "openai",
      model: process.env.SELFHEAL_MODEL || "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  return null;
}

function log(opts, msg) {
  if (opts.verbose) console.error(msg);
}

export { revertPatch };
