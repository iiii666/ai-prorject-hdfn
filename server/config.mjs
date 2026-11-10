import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (
  process.env.DW_TEST_SQLITE !== "1" &&
  existsSync(new URL("../.env", import.meta.url))
)
  loadEnvFile(new URL("../.env", import.meta.url));
