const SUBCOMMANDS = new Set(["run", "diagnose", "apply"]);

const FLAG_SCHEMA = {
  // shared
  "--json": { kind: "bool", key: "json" },
  "--verbose": { kind: "bool", key: "verbose" },
  "--provider": { kind: "value", key: "provider" },
  "--model": { kind: "value", key: "model" },
  "-h": { kind: "bool", key: "help" },
  "--help": { kind: "bool", key: "help" },
  // run
  "--max-attempts": { kind: "int", key: "maxAttempts" },
  "--auto": { kind: "bool", key: "auto" },
  "--dry-run": { kind: "bool", key: "dryRun" },
  "--context-glob": { kind: "list", key: "contextGlobs" },
  "--no-git": { kind: "bool", key: "useGit", value: false },
  // diagnose
  "--from-file": { kind: "value", key: "fromFile" },
  "--command": { kind: "value", key: "commandStr" },
  "--exit-code": { kind: "int", key: "exitCode" },
  "--no-patch": { kind: "bool", key: "wantPatch", value: false },
  // apply
  "--patch-file": { kind: "value", key: "patchFile" },
  "--from-stdin": { kind: "bool", key: "fromStdin" },
};

export function parseArgs(argv) {
  const opts = {
    subcommand: null,
    json: false,
    verbose: false,
    provider: null,
    model: null,
    help: false,
    // run defaults
    maxAttempts: 3,
    auto: false,
    dryRun: false,
    contextGlobs: [],
    useGit: true,
    command: [],
    // diagnose
    fromFile: null,
    commandStr: null,
    exitCode: 1,
    wantPatch: true,
    // apply
    patchFile: null,
    fromStdin: false,
  };

  if (argv.length === 0) {
    opts.help = true;
    return opts;
  }

  // Subcommand detection — first non-flag token before `--` is treated as subcommand
  // Backwards-compat: `selfheal -- cmd` (no subcommand) means `run`.
  let i = 0;
  if (SUBCOMMANDS.has(argv[0])) {
    opts.subcommand = argv[0];
    i = 1;
  } else {
    opts.subcommand = "run";
  }

  let sawSeparator = false;
  while (i < argv.length) {
    const a = argv[i];
    if (opts.subcommand === "run" && !sawSeparator && a === "--") {
      sawSeparator = true;
      i += 1;
      continue;
    }
    if (opts.subcommand === "run" && sawSeparator) {
      opts.command.push(a);
      i += 1;
      continue;
    }
    if (opts.subcommand === "apply" && !a.startsWith("-") && !opts.patchFile) {
      opts.patchFile = a;
      i += 1;
      continue;
    }
    const spec = FLAG_SCHEMA[a];
    if (!spec) {
      // Unknown flag — for `run`, fall into command-as-rest mode
      if (opts.subcommand === "run") {
        sawSeparator = true;
        continue;
      }
      throw new Error(`Unknown flag: ${a}`);
    }
    if (spec.kind === "bool") {
      opts[spec.key] = "value" in spec ? spec.value : true;
      i += 1;
    } else if (spec.kind === "value") {
      opts[spec.key] = argv[++i];
      i += 1;
    } else if (spec.kind === "int") {
      opts[spec.key] = parseInt(argv[++i], 10);
      i += 1;
    } else if (spec.kind === "list") {
      opts[spec.key].push(argv[++i]);
      i += 1;
    }
  }

  if (opts.model) process.env.SELFHEAL_MODEL = opts.model;
  return opts;
}
