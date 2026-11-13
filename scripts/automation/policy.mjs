import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
export const LABELS = [
  "ai-ready",
  "agent:running",
  "agent:review",
  "agent:blocked",
  "agent:done",
];
export const CHECKS = ["unit", "postgres", "build", "e2e"];
export function issueNumber(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw Error("Invalid Issue number");
  return n;
}
export function validateIssue(issue) {
  issueNumber(issue.number);
  if (issue.state !== "open" || issue.pull_request)
    throw Error("열린 Issue만 처리합니다.");
  if (typeof issue.body !== "string" || issue.body.length > 20000)
    throw Error("Issue 본문이 없거나 너무 큽니다.");
  if (
    /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/i.test(
      issue.body,
    )
  )
    throw Error(
      "Issue에 접속 비밀값이 포함된 것으로 보입니다. 값을 제거하고 환경 변수 이름만 작성하세요.",
    );
  for (const h of ["Problem", "Acceptance criteria", "Design", "Tests"]) {
    const match = issue.body.match(
      new RegExp(`^#{2,3} ${h}\\s*\\n([\\s\\S]*?)(?=^#{2,3} |$)`, "mi"),
    );
    if (!match || !match[1].trim() || match[1].trim() === "_No response_")
      throw Error(`${h} 항목을 작성하세요.`);
  }
  return issue;
}
export function safePath(path) {
  return (
    typeof path === "string" &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !/[\x00-\x1f]/.test(path)
  );
}
export function allowedPath(path, phase, n) {
  if (!safePath(path) || /(^|\/)\.env(?:\.|$)/.test(path)) return false;
  const spec = `docs/changes/issue-${issueNumber(n)}.md`;
  if (phase === "spec") return path === spec;
  if (phase !== "implementation") return false;
  if (
    [spec, "docs/spec.md", "docs/architecture.md", "docs/testing.md"].includes(
      path,
    ) ||
    path.startsWith("docs/workflow/") ||
    path.startsWith("docs/changes/")
  )
    return false;
  return /^(src|server|tests|docs)\//.test(path) || path === "README.md";
}
export function validateSpec(text) {
  for (const h of [
    "Problem",
    "Acceptance criteria",
    "Design",
    "Tests",
    "Non-goals",
  ])
    if (!new RegExp(`^## ${h}\\s*$`, "m").test(text))
      throw Error(`설계 문서에 ${h} 항목이 없습니다.`);
  if (text.length < 250) throw Error("설계 내용을 구체적으로 작성하세요.");
}
export function git(args, options = {}) {
  const r = spawnSync("git", args, { encoding: "utf8", ...options });
  if (r.status !== 0)
    throw Error(`git ${args[0]} failed: ${(r.stderr || "").slice(0, 500)}`);
  return r.stdout.trim();
}
export function applyPatch(file, phase, n) {
  const stat = readFileSync(file);
  if (stat.length > 2000000) throw Error("패치가 2MB를 초과합니다.");
  if (!stat.length) throw Error("변경 패치가 비어 있습니다.");
  git(["apply", "--index", "--whitespace=nowarn", file]);
  const paths = git(["diff", "--cached", "--name-only", "-z"])
    .split("\0")
    .filter(Boolean);
  if (!paths.length || paths.some((p) => !allowedPath(p, phase, n)))
    throw Error("자동 작업에서 허용되지 않은 파일을 변경했습니다.");
  const modes = git(["diff", "--cached", "--raw", "--no-renames"]);
  if (modes.split("\n").some((l) => /^:\d+ (120000|160000)/.test(l)))
    throw Error("심볼릭 링크/서브모듈은 자동 패치에 허용하지 않습니다.");
  if (phase === "spec")
    validateSpec(
      readFileSync(`docs/changes/issue-${issueNumber(n)}.md`, "utf8"),
    );
  return { paths, tree: git(["write-tree"]) };
}
export function validVerification(report) {
  return (
    !!report &&
    report.version === 1 &&
    Array.isArray(report.checks) &&
    report.checks.length === CHECKS.length &&
    CHECKS.every(
      (name, i) =>
        report.checks[i].name === name &&
        ["passed", "failed", "skipped"].includes(report.checks[i].status),
    )
  );
}
export function verificationPassed(report) {
  return (
    validVerification(report) &&
    report.checks.every((c) => c.status === "passed" && c.exitCode === 0)
  );
}
export function reportMarkdown({ issue, runUrl, report, base, tree }) {
  const passed = verificationPassed(report);
  return `Closes #${issue.number}\n\n## 설계 및 구현\n- 설계: docs/changes/issue-${issue.number}.md (구현보다 먼저 커밋)\n- 기준 커밋: ${base}\n- 검증 트리: ${tree}\n\n## 독립 검증 결과\n| 검사 | 결과 | 종료 코드 |\n| --- | --- | --- |\n${(report?.checks || []).map((c) => `| ${c.name} | ${c.status} | ${c.exitCode ?? "—"} |`).join("\n")}\n\n[Actions 실행 / 로그 / 아티팩트](${runUrl})\n\n${passed ? "모든 검증 통과. 사람의 코드 리뷰 및 main 보호 규칙을 충족한 후 병합하세요." : "검증 실패 또는 미완료. Draft PR이며 병합할 수 있는 성공 결과로 취급하지 마세요."}\n\n<!-- ai-workflow-report ${JSON.stringify({ version: 1, issue: issue.number, runUrl, passed, checks: report?.checks || [] })} -->`;
}
