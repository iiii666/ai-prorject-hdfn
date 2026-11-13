import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
export async function runVerification({
  commands,
  directory = "work/agent-verification",
  timeout = 20 * 60 * 1000,
} = {}) {
  commands ||= [
    { name: "unit", cmd: "npm", args: ["test"] },
    { name: "postgres", cmd: "npm", args: ["run", "test:pg"] },
    { name: "build", cmd: "npm", args: ["run", "build"] },
    { name: "e2e", cmd: "npm", args: ["run", "test:e2e"] },
  ];
  await mkdir(directory, { recursive: true });
  const checks = [];
  for (const c of commands) {
    const start = Date.now();
    let log = "",
      timedOut = false;
    const p = spawn(c.cmd, c.args, {
      env: { ...process.env, OPENAI_API_KEY: "", DATABASE_URL: "" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const collect = (chunk) => {
      const s = chunk.toString();
      log = (log + s).slice(-2000000);
      process.stdout.write(s);
    };
    p.stdout.on("data", collect);
    p.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {}
    }, timeout);
    let code;
    try {
      code = await new Promise((resolve) => {
        p.once("error", (e) => {
          log += `\n${e.message}\n`;
          resolve(127);
        });
        p.once("exit", (result) => resolve(result ?? 1));
      });
    } finally {
      clearTimeout(timer);
    }
    await writeFile(`${directory}/${c.name}.log`, log);
    checks.push({
      name: c.name,
      status: code === 0 && !timedOut ? "passed" : "failed",
      exitCode: timedOut ? 124 : code,
      durationMs: Date.now() - start,
      log: `${c.name}.log`,
    });
  }
  const report = {
    version: 1,
    checks,
    passed: checks.every((c) => c.status === "passed"),
    finishedAt: new Date().toISOString(),
  };
  await writeFile(`${directory}/results.json`, JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1]?.endsWith("/verify.mjs")) {
  const r = await runVerification();
  process.exitCode = r.passed ? 0 : 1;
}
