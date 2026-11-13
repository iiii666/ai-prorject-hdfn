import { spawn } from "node:child_process";
const python = process.env.DW_PYTHON || "python3",
  base = process.env.DW_BROWSER_URL || "http://127.0.0.1:3001";
const server = process.env.DW_BROWSER_URL
  ? null
  : spawn(process.execPath, ["server/index.mjs"], {
      stdio: "inherit",
      env: { ...process.env, OPENAI_API_KEY: "" },
    });
let exited = false;
server?.on("exit", () => {
  exited = true;
});
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (exited) throw Error("E2E 서버가 시작되지 않았습니다.");
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw Error("E2E 서버 준비 시간 초과");
  for (const file of [
    "tests/investigation_browser_smoke.py",
    "tests/history_browser_smoke.py",
    "tests/workflow_browser_smoke.py",
  ])
    await new Promise((resolve, reject) => {
      const p = spawn(python, [file], {
        stdio: "inherit",
        env: { ...process.env, DW_BROWSER_URL: base },
      });
      p.on("error", reject);
      p.on("exit", (c) =>
        c === 0 ? resolve() : reject(Error(`${file}: exit ${c}`)),
      );
    });
} finally {
  server?.kill("SIGTERM");
}
