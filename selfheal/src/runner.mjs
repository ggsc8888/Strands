import { spawn } from "node:child_process";

const MAX_CAPTURE = 200 * 1024; // 200KB per stream

export function runCommand(argv) {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (stdout.length < MAX_CAPTURE) {
        stdout += chunk.toString("utf8");
        if (stdout.length > MAX_CAPTURE) stdout = stdout.slice(-MAX_CAPTURE);
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      if (stderr.length < MAX_CAPTURE) {
        stderr += chunk.toString("utf8");
        if (stderr.length > MAX_CAPTURE) stderr = stderr.slice(-MAX_CAPTURE);
      }
    });

    child.on("error", (err) => {
      resolve({ exitCode: 127, stdout, stderr: stderr + `\n[selfheal] spawn error: ${err.message}` });
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code == null ? (signal ? 130 : 1) : code,
        stdout,
        stderr,
      });
    });
  });
}
