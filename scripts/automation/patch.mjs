import { applyPatch, git } from "./policy.mjs";
const [phase, file, n] = process.argv.slice(2);
const result = applyPatch(file, phase, n);
git([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "user.name=DW Coding Agent",
  "-c",
  "user.email=dw-agent@users.noreply.github.com",
  "commit",
  "-m",
  `${phase === "spec" ? "docs" : "feat"}: issue #${Number(n)} ${phase}`,
]);
console.log(JSON.stringify(result));
