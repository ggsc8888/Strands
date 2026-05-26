import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function applyPatch(patchText, { useGit = true } = {}) {
  const patchPath = path.join(process.cwd(), `.selfheal-${randomUUID().slice(0, 8)}.patch`);
  writeFileSync(patchPath, patchText);

  const inGitRepo =
    useGit &&
    spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stdout.trim() === "true";

  try {
    if (inGitRepo) {
      // Try -p1 (a/ b/ prefixes), then -p0
      for (const p of ["-p1", "-p0"]) {
        const r = spawnSync("git", ["apply", "--whitespace=nowarn", p, patchPath], { encoding: "utf8" });
        if (r.status === 0) {
          return { method: `git apply ${p}`, patch: patchText };
        }
      }
      // Try unified 3way
      const r3 = spawnSync("git", ["apply", "--3way", "--whitespace=nowarn", patchPath], { encoding: "utf8" });
      if (r3.status === 0) {
        return { method: "git apply --3way", patch: patchText };
      }
      throw new Error(`git apply failed: ${r3.stderr || "unknown error"}`);
    }

    // Fallback: backup affected files to .selfheal-backup/ then apply manually
    const backupDir = path.join(process.cwd(), ".selfheal-backup");
    mkdirSync(backupDir, { recursive: true });
    const affected = parsePatchTargets(patchText);
    for (const f of affected) {
      if (existsSync(f)) {
        const bk = path.join(backupDir, f);
        mkdirSync(path.dirname(bk), { recursive: true });
        copyFileSync(f, bk);
      }
    }
    const r = spawnSync("patch", ["-p1", "-i", patchPath], { encoding: "utf8" });
    if (r.status !== 0) {
      const r0 = spawnSync("patch", ["-p0", "-i", patchPath], { encoding: "utf8" });
      if (r0.status !== 0) {
        throw new Error(`patch failed: ${r.stderr || r0.stderr || "unknown"}`);
      }
      return { method: "patch -p0", patch: patchText, backupDir };
    }
    return { method: "patch -p1", patch: patchText, backupDir };
  } finally {
    try { unlinkSync(patchPath); } catch { /* ignore */ }
  }
}

export async function revertPatch(info) {
  if (!info) return;
  if (info.method.startsWith("git")) {
    spawnSync("git", ["apply", "-R", "--whitespace=nowarn", "-"], { input: info.patch });
  } else if (info.backupDir) {
    const files = parsePatchTargets(info.patch);
    for (const f of files) {
      const bk = path.join(info.backupDir, f);
      if (existsSync(bk)) {
        copyFileSync(bk, f);
      }
    }
  }
}

function parsePatchTargets(patch) {
  const out = new Set();
  for (const line of patch.split("\n")) {
    const m = /^\+\+\+\s+(?:b\/)?(.+?)(?:\s|$)/.exec(line);
    if (m && m[1] !== "/dev/null") out.add(m[1]);
  }
  return [...out];
}
