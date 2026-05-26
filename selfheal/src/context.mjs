import { readFile, stat } from "node:fs/promises";
import { globSync } from "node:fs";
import path from "node:path";

const MAX_FILE_BYTES = 16 * 1024;
const MAX_FILES_FROM_TRACE = 12;
const MAX_GLOB_FILES = 8;

export async function gatherContext({ command, stdout, stderr, exitCode, extraGlobs }) {
  const combined = `${stdout}\n${stderr}`;
  const paths = new Set();

  // Heuristic: pull file paths out of error output
  const pathRe = /(?:^|[\s"'`(\[])((?:\.{0,2}\/)?[\w.\-/]+\.(?:m?[jt]sx?|py|rb|go|rs|java|kt|cs|cpp|c|h|hpp|json|ya?ml|toml|sh|md))(?::(\d+))?/g;
  let m;
  while ((m = pathRe.exec(combined)) !== null) {
    if (paths.size >= MAX_FILES_FROM_TRACE) break;
    paths.add(m[1]);
  }

  // Extra globs from CLI
  for (const g of extraGlobs || []) {
    try {
      const files = globSync(g, { nodir: true }).slice(0, MAX_GLOB_FILES);
      for (const f of files) paths.add(f);
    } catch {
      // ignore
    }
  }

  const files = [];
  for (const p of paths) {
    try {
      const abs = path.resolve(p);
      const s = await stat(abs);
      if (!s.isFile()) continue;
      let content = await readFile(abs, "utf8");
      let truncated = false;
      if (content.length > MAX_FILE_BYTES) {
        content = content.slice(0, MAX_FILE_BYTES);
        truncated = true;
      }
      files.push({ path: path.relative(process.cwd(), abs), content, truncated });
    } catch {
      // not a real file; skip
    }
  }

  return {
    cwd: process.cwd(),
    command: command.join(" "),
    exitCode,
    stdout: tail(stdout, 8000),
    stderr: tail(stderr, 8000),
    files,
  };
}

function tail(s, n) {
  if (!s) return "";
  return s.length <= n ? s : "…(truncated)…\n" + s.slice(-n);
}
