import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResponse } from "../src/diagnose.mjs";

test("extracts a fenced diff block", () => {
  const text = [
    "Root cause: missing semicolon in foo.ts.",
    "",
    "```diff",
    "--- a/src/foo.ts",
    "+++ b/src/foo.ts",
    "@@ -1,1 +1,1 @@",
    "-const x = 1",
    "+const x = 1;",
    "```",
  ].join("\n");
  const r = parseResponse(text);
  assert.match(r.patch, /^--- a\/src\/foo\.ts/m);
  assert.match(r.patch, /^\+\+\+ b\/src\/foo\.ts/m);
  assert.match(r.summary, /Root cause/);
});

test("returns null patch when no diff is present", () => {
  const r = parseResponse("Looks fine to me.");
  assert.equal(r.patch, null);
  assert.equal(r.summary, "Looks fine to me.");
});

test("accepts ```patch fence and unlabeled fence with diff-y headers", () => {
  const patchFenced = "```patch\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-1\n+2\n```";
  assert.ok(parseResponse(patchFenced).patch);

  const bareFenced = "```\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-1\n+2\n```";
  assert.ok(parseResponse(bareFenced).patch);
});

test("ignores non-diff fenced blocks before the real diff", () => {
  const text = [
    "Analysis:",
    "```",
    "some pseudocode",
    "```",
    "Patch:",
    "```diff",
    "--- a/x",
    "+++ b/x",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "```",
  ].join("\n");
  const r = parseResponse(text);
  assert.match(r.patch, /^--- a\/x/m);
});
