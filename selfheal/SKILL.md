---
name: selfheal
description: Run a shell command with an automatic self-healing loop. When the command fails, an LLM diagnoses the root cause from the captured output and source files, proposes a minimal unified-diff patch, applies it, and retries. Use when you want to delegate "run X until it passes" to a single tool call — typical X: tests, builds, lints, type-checks, codegen, migrations. Also exposes `diagnose` (analyze a failure log you already have) and `apply` (apply a unified diff safely with git fallback).
---

# selfheal

`selfheal` is a small CLI that wraps any command in a diagnose-patch-retry loop.

## When to use it

- A test/build/lint command is failing and you want a single tool call to fix-and-retry.
- You already have failure output and want a structured diagnosis without re-running.
- You have a unified-diff patch (from any source) and want it applied safely.

## When NOT to use it

- The fix requires shell commands, package installs, or env changes — `selfheal` only edits files.
- The failing command has side effects you don't want retried (e.g. `rm`, `deploy`).
- You need to interactively edit code — use your normal editing tools.

## Setup

Requires Node.js ≥20 and one of:

- `ANTHROPIC_API_KEY` (default model: `claude-sonnet-4-5`)
- `OPENAI_API_KEY` (default model: `gpt-4o`)

Override the model with `SELFHEAL_MODEL` or `--model`.

The CLI lives at `selfheal/bin/selfheal.mjs` in this repo. Invoke as:

```bash
node selfheal/bin/selfheal.mjs <subcommand> [...flags]
```

## Subcommands

### `run` — auto-heal a command

Runs the command, captures stdout/stderr, and on non-zero exit loops:
gather context → diagnose → propose patch → apply → retry.

```bash
node selfheal/bin/selfheal.mjs run --auto --max-attempts 3 --json -- pnpm test
```

When stdin is not a TTY (e.g. called from an agent), `--auto` is implied.

Key flags: `--max-attempts N`, `--auto`, `--dry-run`, `--context-glob '<glob>'` (repeatable), `--no-git`, `--json`.

Exit code is the final exit code of the wrapped command (0 on success, non-zero on give-up).

### `diagnose` — analyze an existing failure log

Useful when you already have the failed output and just want a structured diagnosis + patch.

```bash
pnpm test 2>&1 | node selfheal/bin/selfheal.mjs diagnose \
  --command 'pnpm test' --exit-code 1 --json
```

Or with a file: `--from-file failure.log`.

Add `--no-patch` for diagnosis only (no diff).

### `apply` — apply a unified diff

```bash
node selfheal/bin/selfheal.mjs apply --from-stdin --json < fix.patch
# or
node selfheal/bin/selfheal.mjs apply --json fix.patch
```

Tries `git apply -p1`, then `-p0`, then `--3way`. Outside a git repo, falls back to GNU `patch` and copies originals to `.selfheal-backup/`.

## JSON output contract

Use `--json` for machine-readable output. Schema by subcommand:

**`run`**
```json
{
  "subcommand": "run",
  "ok": true,
  "exitCode": 0,
  "attempts": [
    { "attempt": 1, "exitCode": 1, "diagnosis": "...", "patchApplied": "git apply -p1" },
    { "attempt": 2, "exitCode": 0 }
  ],
  "reason": "max-attempts | no-patch-produced | dry-run | user-aborted | patch-failed"
}
```

**`diagnose`**
```json
{
  "subcommand": "diagnose",
  "ok": true,
  "summary": "Root cause: ...",
  "patch": "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ ...",
  "files": ["src/foo.ts"],
  "provider": "anthropic",
  "model": "claude-sonnet-4-5"
}
```

**`apply`**
```json
{ "subcommand": "apply", "ok": true, "method": "git apply -p1", "files": ["src/foo.ts"] }
```

## Recommended agent patterns

1. **Trust the wrapper**: prefer `selfheal run --auto --json -- <cmd>`. Parse the JSON, then either continue (ok) or read `attempts[].diagnosis` to decide next steps.
2. **Two-step when destructive**: use `selfheal diagnose --json` to get a patch, inspect it, then `selfheal apply --from-stdin` if you approve.
3. **Add context** when error output doesn't mention files: pass `--context-glob 'src/**/*.ts'` (or whatever scope matches).

## Safety guarantees

- Only file edits are proposed/applied — never shell commands or installs.
- All edits are applied via `git apply` when possible, so `git diff`/`git restore` always reverts them.
- Outside git, originals are copied to `.selfheal-backup/` before patching.
- `--dry-run` performs diagnosis only.
- Captured output is capped at ~200KB per stream so large failures don't blow context.
