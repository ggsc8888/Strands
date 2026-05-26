export function parseArgs(argv) {
  const opts = {
    maxAttempts: 3,
    auto: false,
    dryRun: false,
    provider: null,
    model: null,
    contextGlobs: [],
    useGit: true,
    verbose: false,
    help: false,
    command: [],
  };

  let i = 0;
  let sawSeparator = false;
  while (i < argv.length) {
    const a = argv[i];
    if (!sawSeparator) {
      if (a === "--") {
        sawSeparator = true;
        i += 1;
        continue;
      }
      if (a === "-h" || a === "--help") {
        opts.help = true;
        i += 1;
        continue;
      }
      if (a === "--auto") { opts.auto = true; i += 1; continue; }
      if (a === "--dry-run") { opts.dryRun = true; i += 1; continue; }
      if (a === "--no-git") { opts.useGit = false; i += 1; continue; }
      if (a === "--verbose") { opts.verbose = true; i += 1; continue; }
      if (a === "--max-attempts") { opts.maxAttempts = parseInt(argv[++i], 10) || 3; i += 1; continue; }
      if (a === "--provider") { opts.provider = argv[++i]; i += 1; continue; }
      if (a === "--model") {
        opts.model = argv[++i];
        if (opts.model) process.env.SELFHEAL_MODEL = opts.model;
        i += 1;
        continue;
      }
      if (a === "--context-glob") { opts.contextGlobs.push(argv[++i]); i += 1; continue; }
      // Unknown flag before --: treat the rest as command
      sawSeparator = true;
      continue;
    }
    opts.command.push(a);
    i += 1;
  }
  return opts;
}
