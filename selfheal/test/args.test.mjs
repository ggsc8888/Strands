import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.mjs";

test("defaults to 'run' when no subcommand is given", () => {
  const o = parseArgs(["--", "pnpm", "test"]);
  assert.equal(o.subcommand, "run");
  assert.deepEqual(o.command, ["pnpm", "test"]);
});

test("recognises explicit 'run' subcommand", () => {
  const o = parseArgs(["run", "--auto", "--max-attempts", "5", "--", "pnpm", "build"]);
  assert.equal(o.subcommand, "run");
  assert.equal(o.auto, true);
  assert.equal(o.maxAttempts, 5);
  assert.deepEqual(o.command, ["pnpm", "build"]);
});

test("'diagnose' parses --command and --exit-code", () => {
  const o = parseArgs(["diagnose", "--command", "pnpm test", "--exit-code", "2", "--json"]);
  assert.equal(o.subcommand, "diagnose");
  assert.equal(o.commandStr, "pnpm test");
  assert.equal(o.exitCode, 2);
  assert.equal(o.json, true);
});

test("'apply' takes a positional patch file and --from-stdin", () => {
  const o1 = parseArgs(["apply", "fix.patch"]);
  assert.equal(o1.subcommand, "apply");
  assert.equal(o1.patchFile, "fix.patch");

  const o2 = parseArgs(["apply", "--from-stdin", "--json"]);
  assert.equal(o2.fromStdin, true);
  assert.equal(o2.json, true);
  assert.equal(o2.patchFile, null);
});

test("--context-glob is repeatable", () => {
  const o = parseArgs(["run", "--context-glob", "src/**/*.ts", "--context-glob", "lib/**/*.ts", "--", "pnpm", "test"]);
  assert.deepEqual(o.contextGlobs, ["src/**/*.ts", "lib/**/*.ts"]);
});

test("--no-git flips useGit to false", () => {
  const o = parseArgs(["run", "--no-git", "--", "make"]);
  assert.equal(o.useGit, false);
});

test("--help is recognised", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs([]).help, true);
});

test("unknown flag in 'diagnose' throws", () => {
  assert.throws(() => parseArgs(["diagnose", "--nonsense"]));
});
