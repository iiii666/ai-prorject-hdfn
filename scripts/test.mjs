import { spawn } from "node:child_process";
const p = spawn(
  process.execPath,
  [
    "--test",
    "tests/custom.test.mjs",
    "tests/database.test.mjs",
    "tests/evidence.test.mjs",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, DW_TEST_SQLITE: "1", DW_DB_PATH: ":memory:" },
  },
);
p.on("exit", (code) => (process.exitCode = code || 0));
