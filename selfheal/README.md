# selfheal

A small, open-source CLI that gives any command a **self-healing loop** — and exposes itself as a **tool that any coding agent can call**.

You point `selfheal` at a command. If it exits non-zero, `selfheal`:

1. Captures the command, exit code, stdout, stderr.
2. Auto-detects source files mentioned in the error output and reads them.
3. Sends everything to an LLM (Anthropic or OpenAI) with a strict prompt that asks for a **minimal unified-diff patch**.
4. Applies the patch (via `git apply`, or GNU `patch` with backups).
5. Re-runs the command.

Loops until the command passes or `--max-attempts` is exhausted. Designed to be small, dependency-free (uses Node's built-in `fetch`), and trivially callable from a coding agent's tool harness.

## Install

```bash
# from a clone
git clone <repo> && cd selfheal
node bin/selfheal.mjs --help

# (once published) from npm
npm i -g selfheal
```

Requires **Node.js 20+** and one of:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # default model: claude-sonnet-4-5
# or
export OPENAI_API_KEY=sk-...          # default model: gpt-4o
export SELFHEAL_MODEL=...             # optional override
```

## Subcommands

### `run` — auto-heal a command

```bash
selfheal run --auto --max-attempts 5 -- pnpm test
selfheal -- pnpm test                                # shorthand for `run`
selfheal run --dry-run -- cargo build                # diagnose only, no edits
selfheal run --context-glob 'src/**/*.ts' -- node build.mjs
```

When stdin is not a TTY (typical when called from an agent or CI), `--auto` is implied so you don't deadlock on a confirmation prompt.

### `diagnose` — analyze an existing failure log

For when you already have the output and just want the LLM analysis:

```bash
pnpm test 2>&1 | selfheal diagnose --command 'pnpm test' --exit-code 1 --json
selfheal diagnose --from-file failure.log --no-patch         # diagnosis only
```

### `apply` — apply a unified diff safely

Tries `git apply -p1`, then `-p0`, then `--3way`. Falls back to GNU `patch` with originals copied to `.selfheal-backup/`.

```bash
selfheal apply fix.patch
selfheal apply --from-stdin --json < fix.patch
```

## JSON output

All subcommands accept `--json` and emit a single JSON object on stdout. Exit code mirrors success (0 = ok, non-zero = failure). See [`SKILL.md`](SKILL.md) for the full schema.

```bash
$ selfheal run --json -- pnpm test
{
  "subcommand": "run",
  "ok": true,
  "exitCode": 0,
  "attempts": [
    { "attempt": 1, "exitCode": 1, "diagnosis": "Missing import…", "patchApplied": "git apply -p1" },
    { "attempt": 2, "exitCode": 0 }
  ]
}
```

## Use as a skill for a coding agent

`selfheal` ships with two agent-facing docs:

- [`SKILL.md`](SKILL.md) — for Replit-style agents that auto-discover skills in the workspace.
- [`AGENTS.md`](AGENTS.md) — drop-in tool definitions for OpenAI/Anthropic function-calling and other external agents (Claude Code, Cursor, Aider, Cline, etc.).

The short version: register one tool per subcommand, pass `--json`, parse the response. The agent never has to scrape text or guess about retries — the wrapper handles that loop, feeds prior failed patches back to the model, and returns a structured result.

## Safety

- **File edits only.** `selfheal` never runs shell commands, installs packages, or modifies env on the LLM's behalf.
- **Always recoverable.** In a git repo, `git diff` / `git restore` reverts everything. Outside git, originals are in `.selfheal-backup/`.
- **Bounded.** Output captured per stream is capped at ~200KB; attempts capped by `--max-attempts`; non-TTY runs default to `--auto` (no interactive prompts) so they can never hang.
- Without `--auto`, every patch is shown and confirmed before being applied.
- `--dry-run` produces a diagnosis without touching the filesystem.

## Development

```bash
node --test test/    # runs the test suite (no API key required)
```

## License

MIT
