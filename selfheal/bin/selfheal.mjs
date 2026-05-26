#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

runCli(process.argv.slice(2)).catch((err) => {
  console.error("selfheal: fatal:", err?.stack || err?.message || String(err));
  process.exit(2);
});
