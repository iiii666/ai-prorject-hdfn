import { spawn } from "node:child_process";
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error("Node.js 24 LTS 이상이 필요합니다. node -v로 확인하세요.");
  process.exit(1);
}
const children = [];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
function watch(child) {
  children.push(child);
  child.on("error", (e) => {
    console.error(e);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
  return child;
}
const api = watch(
  spawn(process.execPath, ["server/index.mjs"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { ...process.env, PORT: "3001" },
  }),
);
// Only expose Vite after the database is seeded and the API is listening.
api.once("message", (message) => {
  if (message.type === "dw-ready" && !ending)
    watch(
      spawn(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
        { stdio: "inherit" },
      ),
    );
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
