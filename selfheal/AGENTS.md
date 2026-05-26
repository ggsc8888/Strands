# Using `selfheal` from a coding agent

This document is for **external coding agents** (Claude Code, Cursor, Aider, Continue, Cline, custom OpenAI/Anthropic tool-using agents, CI bots, etc.) that want to call `selfheal` as a tool.

## Contract in one paragraph

`selfheal` is a CLI with three subcommands — `run`, `diagnose`, `apply` — each of which accepts `--json` and emits a single JSON object on stdout. Exit code mirrors success: `0` on success, non-zero on failure. The CLI is dependency-free Node ≥20. The LLM provider is auto-detected from `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the environment.

## Tool definitions (drop-in)

### OpenAI / function-calling style

```json
{
  "name": "selfheal_run",
  "description": "Run a shell command. If it fails, an LLM diagnoses, patches the code, and retries up to N times. Use for: tests, builds, lints, typechecks. Do NOT use for destructive commands.",
  "parameters": {
    "type": "object",
    "properties": {
      "command":      { "type": "array", "items": { "type": "string" }, "description": "argv of the command, e.g. ['pnpm','test']" },
      "max_attempts": { "type": "integer", "default": 3 },
      "context_globs":{ "type": "array", "items": { "type": "string" }, "description": "extra files to send as context" }
    },
    "required": ["command"]
  }
}
```

Shell mapping:

```bash
node selfheal/bin/selfheal.mjs run --auto --json \
  --max-attempts "$max_attempts" \
  $(printf -- '--context-glob %q ' "${context_globs[@]}") \
  -- "${command[@]}"
```

### Anthropic / tool_use style

Same schema; map to the same shell call. Send the stdout JSON back as the tool result.

### `diagnose` tool

```json
{
  "name": "selfheal_diagnose",
  "description": "Analyze an existing failure log and propose a unified-diff patch. Use when you already ran a command and have its output.",
  "parameters": {
    "type": "object",
    "properties": {
      "command":   { "type": "string", "description": "the failed command, for context" },
      "exit_code": { "type": "integer", "default": 1 },
      "log":       { "type": "string", "description": "the captured stdout+stderr" },
      "want_patch":{ "type": "boolean", "default": true }
    },
    "required": ["log"]
  }
}
```

Shell mapping (pass `log` on stdin):

```bash
printf %s "$log" | node selfheal/bin/selfheal.mjs diagnose --json \
  --command "$command" --exit-code "$exit_code" \
  $( [[ "$want_patch" == "false" ]] && echo --no-patch )
```

### `apply` tool

```json
{
  "name": "selfheal_apply",
  "description": "Apply a unified-diff patch using git apply (with -p1 / -p0 / --3way fallbacks). Outside a git repo, falls back to GNU patch with backups in .selfheal-backup/.",
  "parameters": {
    "type": "object",
    "properties": { "patch": { "type": "string" } },
    "required": ["patch"]
  }
}
```

Shell mapping:

```bash
printf %s "$patch" | node selfheal/bin/selfheal.mjs apply --from-stdin --json
```

## Response handling

Every `--json` response is a single JSON object — parse it, don't screen-scrape. See `SKILL.md` for the per-subcommand schema.

Recommended flow:

1. Call `selfheal_run`. If `ok=true`, you're done.
2. If `ok=false` with `reason="no-patch-produced"` or `"patch-failed"`, read `attempts[*].diagnosis` to understand what's wrong, then decide whether to make a manual edit or call `selfheal_diagnose` with more context.
3. Prefer raising `--max-attempts` over wrapping `selfheal_run` in your own retry loop — the wrapper already feeds prior failed patches back to the model.

## Safety

- `selfheal` only ever edits files. It will never run shell commands or install packages on the model's behalf.
- All applied changes are recoverable with `git diff` / `git restore` (or from `.selfheal-backup/` outside a git repo).
- Don't wrap commands that have side effects you don't want repeated (deploys, deletes, network writes).
- Captured output is capped at ~200KB per stream.
