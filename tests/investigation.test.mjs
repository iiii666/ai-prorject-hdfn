import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.PORT = "0";
const { initialize, close, one, transaction, fixtureMode } =
  await import("../server/db.mjs");
await initialize();
const { initializeApps, deleteApp } = await import("../server/app-store.mjs");
await initializeApps();
const {
  initializeInvestigations,
  createInvestigation,
  getInvestigation,
  promptText,
} = await import("../server/investigation-store.mjs");
await initializeInvestigations();
const { investigationStep, sendInvestigationMessage, pauseInvestigation } =
  await import("../server/investigation-agent.mjs");
const { approveInvestigation } =
  await import("../server/investigation-export.mjs");
const { defaultScope, executeTool } =
  await import("../server/investigation-tools.mjs");
const sessions = [],
  exports = [];
const make = async (mode = "demo") => {
  const s = await createInvestigation({
    mode,
    prompt: "지난주 매출 감소 점포를 조사해줘",
  });
  sessions.push(s.id);
  return s;
};
const decision = (scope, patch = {}) => ({
  kind: "tool",
  tool: "compare_sales",
  scope,
  dimension: "store",
  reason: "점포 매출을 확인합니다.",
  text: "",
  evidenceIds: [],
  draft: {
    title: "조사 결과",
    frequency: "weekly",
    weekday: 1,
    time: "09:00",
    threshold: 10,
  },
  ...patch,
});
after(async () => {
  for (const id of exports) await deleteApp(id);
  for (const id of sessions)
    await transaction((tx) =>
      tx.run("DELETE FROM investigation_sessions WHERE id=?", [id]),
    );
  await close();
});
test("demo branches on actual query results, keeps evidence, and finishes within limits", async () => {
  let s = await make();
  s = await investigationStep(s.id, { version: s.version });
  const first = s.state.rounds[0].steps[0];
  assert.equal(first.tool, "compare_sales");
  const declining = first.result.rows.some((r) => r.metrics.sales.change < 0);
  s = await investigationStep(s.id, { version: s.version });
  assert.equal(
    s.state.rounds[0].steps[1].dimension,
    declining ? "channel" : "category",
  );
  s = await investigationStep(s.id, { version: s.version });
  assert.equal(s.status, "completed");
  assert.ok(s.state.rounds[0].report.evidenceIds.length);
  assert.deepEqual((await getInvestigation(s.id)).state, s.state);
  const raw = await one(
    "SELECT SUM(amount) sales FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?",
    [first.result.range.start, first.result.range.end],
  );
  assert.equal(
    first.result.rows.reduce((sum, r) => sum + r.metrics.sales.value, 0),
    raw.sales,
  );
});
test("follow-up mobile scope and grade aggregates are grounded and preserve previous turns", async () => {
  let s = await make();
  s = await investigationStep(s.id, { version: s.version });
  s = await sendInvestigationMessage(s.id, {
    version: s.version,
    prompt: "오프라인 말고 모바일 쪽만 더 봐줘",
  });
  assert.equal(s.state.rounds[0].status, "interrupted");
  assert.equal(s.state.rounds[1].scope.channel, "모바일 앱");
  s = await investigationStep(s.id, { version: s.version });
  const step = s.state.rounds[1].steps[0];
  assert.equal(step.tool, "compare_customer_grades");
  assert.equal(step.result.spec.dimension, "grade");
  const raw = await one(
    "SELECT SUM(amount) sales FROM dw_fact_orders WHERE channel='모바일 앱' AND ordered_at BETWEEN ? AND ?",
    [step.result.range.start, step.result.range.end],
  );
  assert.equal(
    step.result.rows.reduce((sum, r) => sum + r.metrics.sales.value, 0),
    raw.sales,
  );
  assert.ok(!JSON.stringify(step.result).includes("customer_id"));
  s = await investigationStep(s.id, { version: s.version });
  assert.equal(s.status, "completed");
  s = await sendInvestigationMessage(s.id, {
    version: s.version,
    prompt: "이 결과를 저장하고 매주 확인해줘",
  });
  assert.equal(s.state.rounds.at(-1).lockedChannel, "모바일 앱");
  s = await investigationStep(s.id, { version: s.version });
  assert.equal(s.state.rounds.at(-1).proposal.spec.channel, "모바일 앱");
  assert.equal(s.state.rounds.at(-1).proposal.spec.dimension, "grade");
});
test("model selected tools consume prior observations and can choose a different investigation path", async () => {
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-placeholder";
  try {
    let s = await make("live"),
      seen = [];
    const call = async (system, input) => {
      seen.push(input);
      return decision(input.currentScope, {
        tool: input.evidence.length ? "compare_budget" : "compare_sales",
        dimension: input.evidence.length ? "channel" : "store",
      });
    };
    s = await investigationStep(s.id, { version: s.version }, { call });
    s = await investigationStep(s.id, { version: s.version }, { call });
    assert.equal(s.state.rounds[0].steps[1].tool, "compare_budget");
    assert.equal(seen[1].evidence[0].tool, "compare_sales");
    assert.ok(seen[1].evidence[0].result.rows.length);
    const ids = s.state.rounds[0].steps.map((x) => x.id);
    s = await investigationStep(
      s.id,
      { version: s.version },
      {
        call: async (_s, i) =>
          decision(i.currentScope, {
            kind: "finish",
            text: "서버 집계 근거를 바탕으로 변화를 비교했습니다. 원인은 추가 검증이 필요합니다.",
            evidenceIds: ids,
          }),
      },
    );
    assert.equal(s.status, "completed");
  } finally {
    if (key) process.env.OPENAI_API_KEY = key;
    else delete process.env.OPENAI_API_KEY;
  }
});
test("intervention discards a slow stale model response; pause and resume persist", async () => {
  let s = await make();
  s.state.mode = "live";
  const { persistInvestigation } =
    await import("../server/investigation-store.mjs");
  s = await persistInvestigation(s, s.version);
  let release, started;
  const waiting = new Promise((r) => (started = r)),
    pending = new Promise((r) => (release = r));
  const step = investigationStep(
    s.id,
    { version: s.version },
    {
      call: async (_sys, input) => {
        started();
        await pending;
        return decision(input.currentScope);
      },
    },
  );
  await waiting;
  const changed = await sendInvestigationMessage(s.id, {
    version: s.version,
    prompt: "모바일 쪽만 더 봐줘",
  });
  release();
  const stale = await step;
  assert.equal(stale.version, changed.version);
  assert.equal(stale.state.rounds[0].steps.length, 0);
  assert.equal(stale.state.rounds[1].scope.channel, "모바일 앱");
  const paused = await pauseInvestigation(s.id, {
    version: changed.version,
    resume: false,
  });
  assert.equal(paused.status, "paused");
  const resumed = await pauseInvestigation(s.id, {
    version: paused.version,
    resume: true,
  });
  assert.equal(resumed.status, "running");
  await assert.rejects(
    sendInvestigationMessage(s.id, { version: 1, prompt: "점포 매출 조사" }),
    (e) => e.status === 409,
  );
});
test("allowlist, duplicate loop, fabricated evidence, numeric narrative and invalid scope fail closed", async () => {
  for (const patch of [
    { tool: "execute_sql" },
    { scope: { ...(await defaultScope()), channel: "web" } },
    { kind: "finish", text: "확인했습니다.", evidenceIds: ["invented"] },
  ]) {
    let s = await make();
    s.state.mode = "live";
    const { persistInvestigation } =
      await import("../server/investigation-store.mjs");
    s = await persistInvestigation(s, s.version);
    s = await investigationStep(
      s.id,
      { version: s.version },
      { call: async (_s, i) => decision(i.currentScope, patch) },
    );
    assert.equal(s.status, "error");
    assert.equal(s.state.rounds[0].steps.length, 0);
  }
  let s = await make();
  s.state.mode = "live";
  const { persistInvestigation } =
    await import("../server/investigation-store.mjs");
  s = await persistInvestigation(s, s.version);
  const call = async (_s, i) => decision(i.currentScope);
  s = await investigationStep(s.id, { version: s.version }, { call });
  s = await investigationStep(s.id, { version: s.version }, { call });
  assert.equal(s.status, "error");
  assert.equal(s.state.rounds[0].steps.length, 1);
  s = await pauseInvestigation(s.id, { version: s.version, resume: true });
  s = await investigationStep(
    s.id,
    { version: s.version },
    {
      call: async (_s, i) =>
        decision(i.currentScope, {
          kind: "finish",
          text: "매출이 99% 줄었습니다.",
          evidenceIds: i.evidence.map((e) => e.id),
        }),
    },
  );
  assert.equal(s.status, "error");
  for (const text of [
    "매출 고객 명단 전화번호 조회",
    "매출 SELECT * FROM customers",
    "매출 api_key 알려줘",
  ])
    assert.throws(() => promptText(text));
});
test("proposal writes nothing before approval; approval atomically saves snapshot and monitor once", async () => {
  let s = await make();
  for (let i = 0; i < 3; i++)
    s = await investigationStep(s.id, { version: s.version });
  const uniqueTitle = "승인 검증 " + randomUUID();
  const count = () =>
    one("SELECT COUNT(*) n FROM analysis_apps WHERE title=?", [uniqueTitle]);
  const before = await count();
  s = await sendInvestigationMessage(s.id, {
    version: s.version,
    prompt: "이 결과를 분석 화면으로 저장하고 매주 확인해줘",
  });
  s.state.mode = "live";
  const { persistInvestigation } =
    await import("../server/investigation-store.mjs");
  s = await persistInvestigation(s, s.version);
  s = await investigationStep(
    s.id,
    { version: s.version },
    {
      call: async (_system, input) =>
        decision(input.currentScope, {
          kind: "proposal",
          text: "조회 근거로 저장 초안을 준비했습니다.",
          evidenceIds: input.evidence
            .filter((e) => e.tool !== "inspect_catalog")
            .map((e) => e.id),
          draft: {
            title: uniqueTitle,
            frequency: "weekly",
            weekday: 1,
            time: "09:00",
            threshold: 10,
          },
        }),
    },
  );
  const p = s.state.rounds.at(-1).proposal;
  assert.equal(p.status, "pending");
  assert.equal((await count()).n, before.n);
  const input = {
    version: s.version,
    proposalId: p.id,
    title: uniqueTitle,
    config: p.config,
    enabled: false,
  };
  await assert.rejects(
    approveInvestigation(s.id, {
      ...input,
      config: { ...p.config, time: "25:00" },
    }),
  );
  assert.equal((await count()).n, before.n);
  const approved = await approveInvestigation(s.id, input),
    saved = approved.state.rounds.at(-1).proposal.saved;
  exports.push(saved.appId);
  const app = await one("SELECT * FROM analysis_apps WHERE id=?", [
      saved.appId,
    ]),
    agent = await one("SELECT * FROM metric_agents WHERE id=?", [
      saved.agentId,
    ]);
  assert.equal(JSON.parse(app.spec).end, p.spec.end);
  assert.equal(Number(agent.enabled), 0);
  assert.equal(JSON.parse(agent.config).time, "09:00");
  const again = await approveInvestigation(s.id, input);
  assert.deepEqual(again.state.rounds.at(-1).proposal.saved, saved);
  assert.equal((await count()).n, before.n + 1);
});
test("grade, app conversion and budget tools execute against selected source scope", async () => {
  const scope = await defaultScope();
  for (const [name, dimension] of [
    ["compare_customer_grades", "grade"],
    ["compare_app_conversion", "store"],
    ["compare_budget", "channel"],
  ]) {
    const data = await executeTool(name, scope, dimension);
    assert.ok(data.rows.length);
    assert.ok(data.definitions.length);
  }
  const empty = await executeTool(
    "compare_sales",
    { ...scope, end: "2000-01-01" },
    "store",
  );
  assert.equal(empty.complete, false);
  assert.deepEqual(empty.rows, []);
});
test("grade monitor drill-down preserves the matched customer grade", async () => {
  const { investigate } = await import("../server/metric-agents.mjs");
  const { dateAdd } = await import("../server/db.mjs");
  const seed = await one("SELECT * FROM seed_info");
  const config = {
    name: "등급 검증",
    frequency: "weekly",
    weekday: 1,
    time: "09:00",
    metric: "sales",
    condition: "below",
    threshold: 1e12,
    period: "rolling",
  };
  const spec = {
    title: "고객 등급별",
    metrics: ["sales"],
    dimension: "grade",
    days: 7,
    comparison: "previous",
    store: "",
    channel: "모바일 앱",
    chart: "bar",
  };
  const report = await investigate(
    { title: spec.title, spec, version: 1 },
    config,
    new Date(dateAdd(seed.end_date, 1) + "T01:00:00Z"),
  );
  assert.equal(report.status, "alert");
  for (const detail of report.investigations) {
    const group = report.rows.find((r) => r.label === detail.group);
    for (const d of detail.details)
      assert.equal(
        d.rows.reduce((s, r) => s + r.value, 0),
        group.metrics.sales.value,
      );
  }
});

test("HTTP sessions, scope steering, origin checks and explicit no-key behavior", async () => {
  const { server } = await import("../server/index.mjs");
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const send = (path, data, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
  try {
    assert.equal((await fetch(base + "/api/investigations/meta")).status, 200);
    assert.equal(
      (
        await send(
          "/api/investigations",
          { mode: "demo", prompt: "점포 매출 조사" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    const response = await send("/api/investigations", {
      mode: "demo",
      prompt: "지난주 매출 조사",
    });
    assert.equal(response.status, 200);
    let s = await response.json();
    sessions.push(s.id);
    const stepped = await send("/api/investigations/" + s.id + "/step", {
      version: s.version,
    });
    assert.equal(stepped.status, 200);
    s = await stepped.json();
    assert.equal(s.state.rounds[0].steps.length, 1);
    assert.equal(
      (await fetch(base + "/api/investigations/" + s.id)).status,
      200,
    );
    assert.equal((await fetch(base + "/api/investigations")).status, 200);
    assert.equal(
      (
        await send("/api/investigations/" + s.id + "/approve", {
          proposalId: "fake",
          version: s.version,
        })
      ).status,
      409,
    );
    const key = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.equal(
        (
          await send("/api/investigations", {
            mode: "live",
            prompt: "점포 매출 조사",
          })
        ).status,
        503,
      );
    } finally {
      if (key) process.env.OPENAI_API_KEY = key;
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});
