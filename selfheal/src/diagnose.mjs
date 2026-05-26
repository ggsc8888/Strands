const SYSTEM = `You are "selfheal", an expert software-engineering agent embedded in a CLI.
A user's command just failed. You must:
1) Read the command, exit code, stdout, stderr, and any source files provided.
2) Identify the single most likely root cause.
3) Produce a MINIMAL unified-diff patch that fixes it (unless told not to).

OUTPUT FORMAT (strict):
First, a short plain-text diagnosis (2-6 lines) covering: what failed, root cause,
why your fix addresses it.
Then, a fenced code block tagged "diff" containing one unified diff
that applies cleanly from the repo root with: \`git apply -p1\`.

Rules:
- Use file headers "--- a/<path>" and "+++ b/<path>" with hunks "@@ ... @@".
- Use POSIX paths relative to the repo root (matching the paths shown in context).
- Edit only files that were shown to you, unless creating a new file is clearly required.
- For new files, use "--- /dev/null" and "+++ b/<path>".
- Do NOT include explanations inside the diff block.
- Do NOT include shell commands, package installs, or environment changes — only file edits.
- If a previous patch attempt failed (shown below), do NOT repeat the same change.
- If you are guessing because no source was provided, say so in one line before the diff.
- If asked for diagnosis only (no patch), omit the diff block entirely.
`;

export async function diagnose({ provider, context, previous, wantPatch = true }) {
  const user = buildUserMessage(context, previous, wantPatch);
  const text =
    provider.name === "anthropic"
      ? await callAnthropic(provider, user)
      : await callOpenAI(provider, user);
  return parseResponse(text);
}

function buildUserMessage(ctx, previous, wantPatch) {
  const parts = [];
  parts.push(`CWD: ${ctx.cwd}`);
  parts.push(`COMMAND: ${ctx.command}`);
  parts.push(`EXIT CODE: ${ctx.exitCode}`);
  parts.push("");
  if (ctx.stdout) {
    parts.push("STDOUT (tail):");
    parts.push("```");
    parts.push(ctx.stdout);
    parts.push("```");
  }
  parts.push("STDERR / OUTPUT (tail):");
  parts.push("```");
  parts.push(ctx.stderr || "(empty)");
  parts.push("```");
  if (ctx.files.length === 0) {
    parts.push("\nNo source files were auto-detected from the output.");
  } else {
    parts.push(`\nSOURCE FILES (${ctx.files.length}):`);
    for (const f of ctx.files) {
      parts.push(`\n--- file: ${f.path}${f.truncated ? " (truncated)" : ""} ---`);
      parts.push("```");
      parts.push(f.content);
      parts.push("```");
    }
  }
  if (previous) {
    parts.push("\nPREVIOUS PATCH ATTEMPT (did not resolve the failure):");
    parts.push("```diff");
    parts.push(previous.patch);
    parts.push("```");
  }
  parts.push(
    wantPatch
      ? "\nNow produce the diagnosis and the unified-diff patch."
      : "\nNow produce the diagnosis only. Do NOT include a diff block."
  );
  return parts.join("\n");
}

async function callAnthropic(provider, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text) throw new Error("Anthropic returned no text content");
  return text;
}

async function callOpenAI(provider, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned no message content");
  return text;
}

export function parseResponse(text) {
  const fenceRe = /```(?:diff|patch)?\s*\n([\s\S]*?)```/g;
  let patch = null;
  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1];
    if (/^---\s+/m.test(body) && /^\+\+\+\s+/m.test(body)) {
      patch = body.trimEnd() + "\n";
      break;
    }
  }
  const summary = text.replace(/```[\s\S]*?```/g, "").trim() || "(no summary)";
  return { summary, patch, raw: text };
}
