import { createInterface } from "node:readline";

export function confirm(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive: default to "no"
      resolve(false);
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}
