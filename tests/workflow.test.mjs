import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  allowedPath,
  validateIssue,
  validateSpec,
  issueNumber,
  verificationPassed,
  reportMarkdown,
  applyPatch,
  CHECKS,
} from "../scripts/automation/policy.mjs";
import { runVerification } from "../scripts/automation/verify.mjs";
import {
  buildBoard,
  developmentBoard,
} from "../server/development-workflow.mjs";
const task = {
  number: 12,
  state: "open",
  title: "점포 매출 비중",
  body: "## Problem\n비교가 필요합니다.\n## Acceptance criteria\n- 비중 합계 일치\n## Design\n매출 화면과 API를 사용합니다.\n## Tests\nUnit 및 E2E로 검증합니다.",
};
const report = {
  version: 1,
  checks: CHECKS.map((name) => ({ name, status: "passed", exitCode: 0 })),
};
const design =
  "# Issue 12\n" +
  ["Problem", "Acceptance criteria", "Design", "Tests", "Non-goals"]
    .map(
      (h) =>
        "## " +
        h +
        "\n" +
        "구체적인 요구사항과 구현 범위 및 검증 방법을 기록합니다. ".repeat(3),
    )
    .join("\n");
test("Issue requires explicit acceptance/design/tests and numeric identity", () => {
  assert.equal(validateIssue(task).number, 12);
  for (const body of ["", task.body.replace("## Tests", "## Notes")])
    assert.throws(() => validateIssue({ ...task, body }));
  assert.throws(() => validateIssue({ ...task, state: "closed" }));
  for (const v of ["1; rm -rf /", 0, -1, "NaN"])
    assert.throws(() => issueNumber(v));
  assert.throws(() => validateSpec("## Design\n짧은 내용"));
  validateSpec(design);
});
test("spec phase is doc-only; implementation cannot rewrite policy, credentials or approved design", () => {
  assert.ok(allowedPath("docs/changes/issue-12.md", "spec", 12));
  for (const p of [
    "src/App.tsx",
    ".github/workflows/build.yml",
    "docs/changes/issue-13.md",
  ])
    assert.equal(allowedPath(p, "spec", 12), false);
  for (const p of [
    "src/App.tsx",
    "server/analytics.mjs",
    "tests/new.test.mjs",
    "README.md",
  ])
    assert.ok(allowedPath(p, "implementation", 12));
  for (const p of [
    "package.json",
    "package-lock.json",
    "AGENTS.md",
    ".env",
    "src/.env.local",
    "scripts/automation/policy.mjs",
    "docs/spec.md",
    "docs/changes/issue-12.md",
    "src/../../.env",
    "/etc/passwd",
    "src\\App.tsx",
  ])
    assert.equal(allowedPath(p, "implementation", 12), false);
});
test("actual git patch policy preserves spec-first order and blocks forbidden patches", () => {
  const cwd = process.cwd(),
    dir = mkdtempSync(join(tmpdir(), "dw-policy-"));
  const run = (args) => {
    const p = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    return p.stdout;
  };
  try {
    run(["init", "-q"]);
    run(["config", "user.name", "Test"]);
    run(["config", "user.email", "test@example.invalid"]);
    writeFileSync(join(dir, "README.md"), "base\n");
    run(["add", "."]);
    run(["commit", "-qm", "base"]);
    const base = run(["rev-parse", "HEAD"]).trim();
    mkdirSync(join(dir, "docs/changes"), { recursive: true });
    writeFileSync(join(dir, "docs/changes/issue-12.md"), design);
    run(["add", "."]);
    const spec = run(["diff", "--cached", "--binary"]);
    run(["reset", "--hard", base]);
    const patch = join(dir, "spec.patch");
    writeFileSync(patch, spec);
    process.chdir(dir);
    const result = applyPatch(patch, "spec", 12);
    assert.deepEqual(result.paths, ["docs/changes/issue-12.md"]);
    run(["commit", "-qm", "design first"]);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/feature.ts"), "export const value=1;\n");
    run(["add", "src"]);
    const implementation = run(["diff", "--cached", "--binary"]);
    run(["reset", "--hard", "HEAD"]);
    writeFileSync(join(dir, "implementation.patch"), implementation);
    applyPatch(join(dir, "implementation.patch"), "implementation", 12);
    run(["commit", "-qm", "implementation"]);
    assert.deepEqual(run(["log", "--format=%s", "-2"]).trim().split("\n"), [
      "implementation",
      "design first",
    ]);
    writeFileSync(join(dir, "package.json"), "{}");
    run(["add", "package.json"]);
    const bad = run(["diff", "--cached", "--binary"]);
    run(["reset", "--hard", "HEAD"]);
    writeFileSync(join(dir, "bad.patch"), bad);
    assert.throws(
      () => applyPatch(join(dir, "bad.patch"), "implementation", 12),
      /허용되지/,
    );
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
test("verification records real exits, continues after failure and excludes live credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dw-verify-"));
  try {
    const commands = CHECKS.map((name, i) => ({
      name,
      cmd: process.execPath,
      args: [
        "-e",
        `if(process.env.OPENAI_API_KEY||process.env.DATABASE_URL)process.exit(91); console.log('${name} executed'); process.exit(${i === 1 ? 2 : 0});`,
      ],
    }));
    const r = await runVerification({
      commands,
      directory: dir,
      timeout: 5000,
    });
    assert.equal(r.passed, false);
    assert.equal(r.checks[1].exitCode, 2);
    assert.equal(r.checks[3].status, "passed");
    assert.ok(
      readFileSync(join(dir, "e2e.log"), "utf8").includes("e2e executed"),
    );
    assert.equal(
      JSON.parse(readFileSync(join(dir, "results.json"), "utf8")).checks.length,
      4,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("PR report never treats missing/failed/skipped tests as passing", () => {
  assert.ok(verificationPassed(report));
  assert.equal(verificationPassed(null), false);
  assert.equal(
    verificationPassed({ ...report, checks: report.checks.slice(1) }),
    false,
  );
  assert.equal(
    verificationPassed({
      ...report,
      checks: report.checks.map((c) => ({ ...c, status: "skipped" })),
    }),
    false,
  );
  const md = reportMarkdown({
    issue: task,
    report,
    runUrl: "https://github.com/a/b/actions/runs/1",
    base: "abc",
    tree: "def",
  });
  assert.ok(md.includes("Closes #12"));
  assert.ok(md.includes("ai-workflow-report"));
  assert.ok(md.includes("| e2e | passed | 0 |"));
  assert.ok(
    reportMarkdown({
      issue: task,
      report: null,
      runUrl: "url",
      base: "abc",
      tree: "def",
    }).includes("실패 또는 미완료"),
  );
});
const makeIssue = (number, labels = [], state = "open") => ({
  ...task,
  number,
  labels: labels.map((name) => ({ name })),
  state,
  created_at: "2026-11-13T00:00:00Z",
  updated_at: "2026-11-13T00:10:00Z",
  html_url: `https://github.com/a/b/issues/${number}`,
});
const makePR = (n, fields = {}) => ({
  number: n + 100,
  body: `Closes #${n}`,
  state: "open",
  head: { ref: `agent/issue-${n}-99-1` },
  created_at: "2026-11-13T00:10:00Z",
  html_url: `https://github.com/a/b/pull/${n + 100}`,
  ...fields,
});
test("board derives real stages and distinguishes failure, review, merge and manual cancellation", () => {
  const issues = [
    makeIssue(1),
    makeIssue(2, ["agent:running"]),
    makeIssue(3),
    makeIssue(4),
    makeIssue(5),
    { ...makeIssue(6, [], "closed"), state_reason: "not_planned" },
    { ...makeIssue(7), pull_request: {} },
  ];
  const prs = [
    makePR(3),
    makePR(4, { draft: true }),
    makePR(5, { state: "closed", merged_at: "2026-11-13T00:11:00Z" }),
  ];
  const b = buildBoard(issues, prs, "a/b");
  assert.deepEqual(b.counts, {
    ready: 1,
    running: 1,
    review: 1,
    blocked: 2,
    done: 1,
  });
  assert.equal(b.tasks.length, 6);
  assert.equal(b.tasks.find((t) => t.number === 3).leadMinutes, 10);
  assert.equal(b.automationPRs, 3);
});
test("board links test evidence safely and discards malformed metadata", () => {
  const md = reportMarkdown({
    issue: { number: 12 },
    report,
    runUrl: "https://github.com/a/b/actions/runs/1",
    base: "a",
    tree: "b",
  });
  const b = buildBoard([makeIssue(12)], [makePR(12, { body: md })], "a/b");
  assert.equal(b.tasks[0].report.checks.length, 4);
  assert.ok(b.tasks[0].report.passed);
  const bad = buildBoard(
    [makeIssue(12)],
    [makePR(12, { body: "Closes #12\n<!-- ai-workflow-report invalid -->" })],
    "a/b",
  );
  assert.equal(bad.tasks[0].report, null);
  const unsafe = buildBoard(
    [{ ...makeIssue(12), html_url: "javascript:alert(1)" }],
    [],
    "a/b",
  );
  assert.equal(unsafe.tasks[0].url, null);
});
test("public board caches requests and surfaces GitHub rate limits instead of fake data", async () => {
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    assert.ok(
      url.startsWith("https://api.github.com/repos/iiii666/ai-prorject-hdfn/"),
    );
    return { ok: true, json: async () => [] };
  };
  const a = await developmentBoard({ fetcher, now: 1000 });
  const b = await developmentBoard({ fetcher, now: 2000 });
  assert.equal(calls, 2);
  assert.equal(a.source, "github");
  assert.equal(b.cached, true);
  await assert.rejects(
    developmentBoard({
      fetcher: async () => ({ ok: false, status: 403 }),
      now: 100000,
    }),
    /한도/,
  );
});

test("prepare gates missing keys and unauthorized actors, then creates an Issue-scoped branch without executing issue text", async () => {
  const originalCwd = process.cwd(),
    originalFetch = globalThis.fetch;
  const names = [
    "GITHUB_REPOSITORY",
    "GITHUB_ACTOR",
    "GITHUB_TOKEN",
    "GITHUB_EVENT_PATH",
    "GITHUB_OUTPUT",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "CODEX_AVAILABLE",
  ];
  const env = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  const dir = mkdtempSync(join(tmpdir(), "dw-prepare-"));
  let trusted = true;
  const calls = [];
  try {
    process.chdir(dir);
    Object.assign(process.env, {
      GITHUB_REPOSITORY: "a/b",
      GITHUB_ACTOR: "team",
      GITHUB_TOKEN: "dummy-test-token",
      GITHUB_EVENT_PATH: join(dir, "event.json"),
      GITHUB_OUTPUT: join(dir, "output"),
      GITHUB_RUN_ID: "99",
      GITHUB_RUN_ATTEMPT: "1",
      CODEX_AVAILABLE: "false",
    });
    writeFileSync(
      process.env.GITHUB_EVENT_PATH,
      JSON.stringify({ issue: { number: 12 } }),
    );
    writeFileSync(process.env.GITHUB_OUTPUT, "");
    const issue = {
      ...task,
      title: "Literal $(touch should-not-exist)",
      labels: [{ name: "ai-ready" }],
      html_url: "https://github.com/a/b/issues/12",
    };
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname.replace("/repos/a/b", "");
      const method = options.method || "GET";
      calls.push({
        path,
        method,
        body: options.body ? JSON.parse(options.body) : null,
      });
      let data = {};
      if (path.includes("/permission"))
        data = { permission: trusted ? "write" : "read" };
      else if (path === "/issues/12" && method === "GET") data = issue;
      else if (path === "/pulls") data = [];
      else if (path === "") data = { default_branch: "main" };
      else if (path === "/git/ref/heads/main")
        data = { object: { sha: "a".repeat(40) } };
      return { ok: true, status: 200, json: async () => data };
    };
    const { prepare } = await import("../scripts/automation/github.mjs");
    await prepare();
    assert.ok(
      calls.some(
        (c) =>
          c.path === "/issues/12" &&
          c.method === "PATCH" &&
          c.body.labels.includes("agent:blocked"),
      ),
    );
    assert.equal(
      calls.some((c) => c.path === "/git/refs"),
      false,
    );
    calls.length = 0;
    trusted = false;
    await prepare();
    assert.equal(
      calls.some((c) => c.method !== "GET"),
      false,
    );
    calls.length = 0;
    trusted = true;
    process.env.CODEX_AVAILABLE = "true";
    await prepare();
    const branch = calls.find((c) => c.path === "/git/refs");
    assert.equal(branch.body.ref, "refs/heads/agent/issue-12-99-1");
    assert.equal(
      JSON.parse(readFileSync(join(dir, ".agent-context/issue.json"), "utf8"))
        .title,
      issue.title,
    );
    assert.equal(existsSync(join(dir, "should-not-exist")), false);
    assert.ok(
      readFileSync(process.env.GITHUB_OUTPUT, "utf8").includes("run=true"),
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing verification command is recorded as failed and later checks still execute", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dw-missing-"));
  try {
    const r = await runVerification({
      directory: dir,
      timeout: 1000,
      commands: [
        { name: "unit", cmd: "dw-command-that-does-not-exist", args: [] },
        {
          name: "build",
          cmd: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
      ],
    });
    assert.equal(r.checks[0].status, "failed");
    assert.equal(r.checks[0].exitCode, 127);
    assert.equal(r.checks[1].status, "passed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review CI status is posted only for the matching same-repository PR HEAD", async () => {
  const cwd = process.cwd(),
    fetcher = globalThis.fetch;
  const keys = [
    "GITHUB_EVENT_PATH",
    "GITHUB_REPOSITORY",
    "GITHUB_TOKEN",
    "GITHUB_RUN_ID",
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const dir = mkdtempSync(join(tmpdir(), "dw-ci-sync-"));
  const writes = [];
  try {
    process.chdir(dir);
    Object.assign(process.env, {
      GITHUB_REPOSITORY: "a/b",
      GITHUB_TOKEN: "dummy-test-token",
      GITHUB_RUN_ID: "100",
      GITHUB_EVENT_PATH: join(dir, "event.json"),
    });
    writeFileSync(
      process.env.GITHUB_EVENT_PATH,
      JSON.stringify({
        workflow_run: {
          name: "Build",
          event: "pull_request",
          repository: { full_name: "a/b" },
          head_sha: "a".repeat(40),
          conclusion: "success",
          html_url: "https://github.com/a/b/actions/runs/100",
          pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }],
        },
      }),
    );
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname.replace("/repos/a/b", "");
      const method = options.method || "GET";
      if (method !== "GET")
        writes.push({ path, body: JSON.parse(options.body) });
      let data = {};
      if (path.startsWith("/pulls/")) {
        const n = Number(path.split("/").at(-1));
        data = {
          number: n,
          body: "Closes #12",
          draft: false,
          head: {
            ref: "agent/issue-12-99-1",
            sha: n === 2 ? "b".repeat(40) : "a".repeat(40),
            repo: { full_name: n === 3 ? "other/fork" : "a/b" },
          },
        };
      } else if (path === "/issues/12") data = { labels: [] };
      return { ok: true, status: 200, json: async () => data };
    };
    const { ciSync } = await import("../scripts/automation/github.mjs");
    await ciSync();
    const checks = writes.filter((w) => w.path === "/check-runs");
    assert.equal(checks.length, 1);
    assert.equal(checks[0].body.head_sha, "a".repeat(40));
    assert.equal(checks[0].body.conclusion, "success");
  } finally {
    globalThis.fetch = fetcher;
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
