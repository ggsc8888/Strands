import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyPatch } from "../src/patcher.mjs";

async function withTempRepo(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "selfheal-test-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["config", "user.email", "t@t.t"], { cwd: dir });
    spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
    await fn(dir);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("applyPatch applies a unified diff via git apply", async () => {
  await withTempRepo(async (dir) => {
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src/a.txt"), "hello\n");
    spawnSync("git", ["add", "."], { cwd: dir });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

    const patch =
      "--- a/src/a.txt\n" +
      "+++ b/src/a.txt\n" +
      "@@ -1 +1 @@\n" +
      "-hello\n" +
      "+goodbye\n";

    const info = await applyPatch(patch, { useGit: true });
    assert.match(info.method, /^git apply/);
    assert.equal(readFileSync(path.join(dir, "src/a.txt"), "utf8"), "goodbye\n");
  });
});

test("applyPatch creates new files from /dev/null diffs", async () => {
  await withTempRepo(async (dir) => {
    const patch =
      "--- /dev/null\n" +
      "+++ b/new.txt\n" +
      "@@ -0,0 +1 @@\n" +
      "+fresh\n";
    const info = await applyPatch(patch, { useGit: true });
    assert.match(info.method, /git apply/);
    assert.equal(readFileSync(path.join(dir, "new.txt"), "utf8"), "fresh\n");
  });
});

test("applyPatch throws on an invalid diff", async () => {
  await withTempRepo(async () => {
    await assert.rejects(() => applyPatch("not a diff\n", { useGit: true }));
  });
});
