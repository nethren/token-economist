import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const childEnv = {
  ...process.env,
  QUALITY_LAB_PROXY_TOKEN: randomUUID(),
};
const children = [
  spawn(process.execPath, [resolve(projectRoot, "server/quality-proxy.mjs")], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
  }),
];

let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

for (const child of children) {
  child.on("error", () => close(1));
  child.on("exit", (code, signal) => {
    if (!closing) close(code ?? (signal ? 1 : 0));
  });
}

process.on("SIGINT", () => close(0));
process.on("SIGTERM", () => close(0));
