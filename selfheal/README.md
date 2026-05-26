# selfheal

A tiny, open-source CLI wrapper that gives any command a **self-healing loop**.

You point `selfheal` at a command. If the command exits non-zero, `selfheal`:

1. Captures the command, exit code, stdout, stderr.
2. Auto-detects source files mentioned in the error output and reads them.
3. Sends everything to an LLM (Anthropic or OpenAI) with a strict prompt asking for a **minimal unified-diff patch**.
4. Shows you the diagnosis and the patch.
5. Applies the patch (via `git apply`, or `patch` with backups) — interactively, or automatically with `--auto`.
6. Re-runs the command.

It loops until the command passes or `--max-attempts` is exhausted.

Designed to be small, dependency-free (uses Node's built-in `fetch`), and easy to drop into CI, a Makefile, or a coding agent's toolbox.

## Install

```bash
# from npm (once published)
npm i -g selfheal

# or run from a clone
git clone <repo> && cd selfheal
node bin/selfheal.mjs --help
```

Requires **Node.js 20+**.

## Configure

Set one of:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

Optional:

```bash
export SELFHEAL_MODEL=claude-sonnet-4-5   # or gpt-4o, etc.
```

## Use

```bash
# Interactive: prompts before applying each patch
selfheal -- pnpm test

# Fully automatic, up to 5 attempts
selfheal --auto --max-attempts 5 -- python -m pytest -x

# Diagnose only, never modify files
selfheal --dry-run -- cargo build

# Force a provider and feed extra files as context
selfheal --provider openai --context-glob 'src/**/*.ts' -- node build.mjs
```

Everything after `--` is the command to run, verbatim.

## How it heals

- **Detect** — non-zero exit code triggers the loop.
- **Read** — error output is scanned for file paths (`src/foo.ts`, `app/main.py`, etc.); those files are read and sent as context. You can add more with `--context-glob`.
- **Diagnose** — the LLM is prompted to identify the root cause and emit a fenced ` ```diff ` block.
- **Apply** — tried via `git apply -p1` → `-p0` → `--3way`. Outside a git repo, falls back to GNU `patch` with originals copied to `.selfheal-backup/`.
- **Retry** — runs the command again. Loops until success or out of attempts. If a patch didn't help, the next attempt is told what was already tried.

## Safety

- Patches are **only edits to files** — `selfheal` will never run shell commands, install packages, or modify env on the LLM's behalf.
- Without `--auto`, every patch is shown and confirmed before being applied.
- In a git repo, you can always `git diff` / `git restore` to undo. Outside git, originals are in `.selfheal-backup/`.
- `--dry-run` produces a diagnosis and proposed patch without touching the filesystem.

## Use as a skill for a coding agent

A coding agent can shell out to `selfheal --auto -- <build|test|lint>` as a single tool call and trust it to either succeed or surface a useful diagnosis. The exit code matches the wrapped command's final exit code, so it composes cleanly with CI and Make targets.

## License

MIT
