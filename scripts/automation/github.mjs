import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import {
  issueNumber,
  validateIssue,
  LABELS,
  applyPatch,
  git,
  validVerification,
  verificationPassed,
  reportMarkdown,
} from "./policy.mjs";
const repo = process.env.GITHUB_REPOSITORY;
function ensureRepo() {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw Error("Invalid repository");
}
export async function api(path, method = "GET", body) {
  ensureRepo();
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = new Error(`GitHub ${method} ${path}: ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.status === 204 ? null : r.json();
}
const output = (key, value) =>
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
const runUrl = () =>
  `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
async function ensureLabels() {
  for (const name of LABELS)
    try {
      await api("/labels", "POST", {
        name,
        color: {
          "ai-ready": "bfd4f2",
          "agent:running": "fbca04",
          "agent:review": "c5def5",
          "agent:blocked": "f9d0c4",
          "agent:done": "c2e0c6",
        }[name],
      });
    } catch (e) {
      if (e.status !== 422) throw e;
    }
}
async function status(n, label, message) {
  const issue = await api(`/issues/${n}`);
  const labels = (issue.labels || [])
    .map((l) => l.name)
    .filter((l) => !LABELS.includes(l));
  await api(`/issues/${n}`, "PATCH", { labels: [...labels, label] });
  if (message)
    await api(`/issues/${n}/comments`, "POST", {
      body: `${message}\n\n[자동화 실행](${runUrl()})`,
    });
}
async function authorized() {
  try {
    const p = await api(
      `/collaborators/${encodeURIComponent(process.env.GITHUB_ACTOR)}/permission`,
    );
    return ["admin", "maintain", "write"].includes(p.permission);
  } catch {
    return false;
  }
}
export async function setup() {
  if (!(await authorized())) throw Error("팀의 쓰기 권한이 필요합니다.");
  await ensureLabels();
  console.log(
    "Labels ready. See docs/workflow/setup.md for Secrets, PR permissions and main protection.",
  );
}
export async function prepare() {
  output("run", "false");
  if (!(await authorized())) {
    console.log("Trusted write actor required; skipped.");
    return;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const n = issueNumber(event.issue?.number || event.inputs?.issue_number);
  const issue = await api(`/issues/${n}`);
  if (
    issue.state !== "open" ||
    !issue.labels.some((l) => l.name === "ai-ready")
  ) {
    console.log("Open ai-ready Issue required; skipped.");
    return;
  }
  await ensureLabels();
  try {
    validateIssue(issue);
  } catch (e) {
    await status(n, "agent:blocked", e.message);
    return;
  }
  const prs = await api("/pulls?state=open&per_page=100");
  if (
    prs.some(
      (p) =>
        p.head.ref.startsWith(`agent/issue-${n}-`) &&
        p.body?.includes(`Closes #${n}`),
    )
  ) {
    console.log("Existing open agent PR; skipped.");
    return;
  }
  if (process.env.CODEX_AVAILABLE !== "true") {
    await status(
      n,
      "agent:blocked",
      "OPENAI_API_KEY Actions Secret이 없습니다. 키를 등록한 뒤 ai-ready를 다시 지정하세요. 모델은 실행하지 않았습니다.",
    );
    return;
  }
  const repository = await api("");
  const base = (await api(`/git/ref/heads/${repository.default_branch}`)).object
    .sha;
  const branch = `agent/issue-${n}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  await api("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: base });
  mkdirSync(".agent-context", { recursive: true });
  writeFileSync(
    ".agent-context/issue.json",
    JSON.stringify({
      number: n,
      title: issue.title,
      body: issue.body,
      url: issue.html_url,
      base,
      branch,
    }),
  );
  output("issue", n);
  output("base", base);
  output("branch", branch);
  output("run", "true");
  await status(
    n,
    "agent:running",
    "AI 작업 시작: 설계 문서를 먼저 작성한 뒤 구현과 독립 검증을 수행합니다.",
  );
}
export async function publish() {
  const n = issueNumber(process.env.ISSUE_NUMBER);
  if (process.env.POLICY_OK !== "true") {
    await status(
      n,
      "agent:blocked",
      "에이전트 실행 또는 패치 검증이 완료되지 않았습니다. 변경을 게시하지 않았습니다. 실행 로그를 확인하세요.",
    );
    return;
  }
  const issue = JSON.parse(readFileSync(".agent-context/issue.json", "utf8"));
  if (
    issue.number !== n ||
    !/^[a-f0-9]{40}$/.test(issue.base) ||
    !new RegExp(`^agent/issue-${n}-\\d+-\\d+$`).test(issue.branch)
  )
    throw Error("Invalid task metadata");
  if ((await api(`/issues/${n}`)).state !== "open") {
    console.log("Issue closed; publication skipped.");
    return;
  }
  const remote = (await api(`/git/ref/heads/${issue.branch}`)).object.sha;
  if (remote !== issue.base)
    throw Error("작업 브랜치가 외부에서 변경되어 게시를 중단합니다.");
  applyPatch(".agent-patches/spec.patch", "spec", n);
  git([
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=DW Coding Agent",
    "-c",
    "user.email=dw-agent@users.noreply.github.com",
    "commit",
    "-m",
    `docs: design for #${n}`,
  ]);
  applyPatch(".agent-patches/implementation.patch", "implementation", n);
  const tree = git(["write-tree"]);
  if (tree !== process.env.TESTED_TREE)
    throw Error("게시 트리가 검증 트리와 다릅니다.");
  git([
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "user.name=DW Coding Agent",
    "-c",
    "user.email=dw-agent@users.noreply.github.com",
    "commit",
    "-m",
    `feat: implement #${n}`,
  ]);
  const token = process.env.GITHUB_TOKEN;
  const auth = Buffer.from(`x-access-token:${token}`).toString("base64");
  const pushed = spawnSync(
    "git",
    ["push", "origin", `HEAD:refs/heads/${issue.branch}`],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}`,
        GIT_CONFIG_KEY_1: "core.hooksPath",
        GIT_CONFIG_VALUE_1: "/dev/null",
      },
    },
  );
  if (pushed.status !== 0)
    throw Error("브랜치 게시 실패. GitHub Actions 쓰기 권한을 확인하세요.");
  const head = git(["rev-parse", "HEAD"]);
  let report;
  try {
    report = JSON.parse(
      readFileSync("work/agent-verification/results.json", "utf8"),
    );
  } catch {}
  if (!validVerification(report))
    report = {
      version: 1,
      checks: ["unit", "postgres", "build", "e2e"].map((name) => ({
        name,
        status: "skipped",
        exitCode: null,
      })),
    };
  const passed = process.env.VERIFIED === "true" && verificationPassed(report);
  if (!passed && verificationPassed(report))
    report.checks[0] = { name: "unit", status: "failed", exitCode: 1 };
  const body = reportMarkdown({
    issue,
    runUrl: runUrl(),
    report,
    base: issue.base,
    tree,
  });
  const repository = await api("");
  const pr = await api("/pulls", "POST", {
    title: `[AI #${n}] ${issue.title}`.slice(0, 240),
    head: issue.branch,
    base: repository.default_branch,
    body,
    draft: !passed,
  });
  await api("/check-runs", "POST", {
    name: "AI workflow verification",
    head_sha: head,
    status: "completed",
    conclusion: passed ? "success" : "failure",
    details_url: runUrl(),
    output: {
      title: passed
        ? "Independent verification passed"
        : "Verification failed/incomplete",
      summary: body.slice(0, 60000),
    },
  });
  await status(
    n,
    passed ? "agent:review" : "agent:blocked",
    `[PR #${pr.number}](${pr.html_url}) 생성. ${passed ? "독립 검증 통과. 사람 리뷰를 기다립니다." : "실패/미완료 결과를 포함한 Draft입니다. 로그를 확인하고 후속 Issue로 수정하세요."}`,
  );
  console.log(pr.html_url);
}
export async function sync() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    pr = event.pull_request;
  if (
    !pr?.merged ||
    !pr.head.ref.startsWith("agent/issue-") ||
    pr.head.repo?.full_name !== repo ||
    pr.base?.ref !== event.repository?.default_branch
  )
    return;
  const match = pr.body?.match(/Closes #(\d+)/);
  if (!match) return;
  await ensureLabels();
  await status(
    issueNumber(match[1]),
    "agent:done",
    `PR #${pr.number}이 병합됐습니다. GitHub가 연결 Issue를 닫습니다.`,
  );
}
export async function ciSync() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const run = event.workflow_run;
  if (
    run?.name !== "Build" ||
    run.event !== "pull_request" ||
    run.repository?.full_name !== repo
  )
    return;
  for (const associated of run.pull_requests || []) {
    const pr = await api(`/pulls/${issueNumber(associated.number)}`);
    if (
      pr.head.repo?.full_name !== repo ||
      !pr.head.ref.startsWith("agent/issue-") ||
      pr.head.sha !== run.head_sha
    )
      continue;
    const match = pr.body?.match(/Closes #(\d+)/);
    if (!match) continue;
    const passed = run.conclusion === "success";
    await api("/check-runs", "POST", {
      name: "AI workflow verification",
      head_sha: pr.head.sha,
      status: "completed",
      conclusion: passed ? "success" : "failure",
      details_url: run.html_url,
      output: {
        title: passed
          ? "Build CI verification passed"
          : "Build CI verification failed",
        summary:
          "사람이 수정한 PR HEAD를 기존 Build workflow의 Unit/PostgreSQL/Build/E2E 결과로 다시 검증했습니다. " +
          run.html_url,
      },
    });
    await status(
      issueNumber(match[1]),
      passed && !pr.draft ? "agent:review" : "agent:blocked",
      `수정된 PR #${pr.number}: [Build 검증](${run.html_url}) ${passed ? "통과" : "실패/중단"}. ${pr.draft ? "Draft 해제는 사람이 확인한 뒤 진행하세요." : ""}`,
    );
  }
}
const action = process.argv[2];
if (["setup", "prepare", "publish", "sync", "ciSync"].includes(action)) {
  try {
    await { setup, prepare, publish, sync, ciSync }[action]();
  } catch (e) {
    console.error(e.message);
    if (action === "publish" && process.env.ISSUE_NUMBER)
      try {
        await status(
          issueNumber(process.env.ISSUE_NUMBER),
          "agent:blocked",
          "게시 단계에 실패했습니다. Actions의 PR 생성/체크 쓰기 권한 및 실행 로그를 확인하세요.",
        );
      } catch {}
    process.exitCode = 1;
  }
}
