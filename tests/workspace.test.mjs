import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import assert from "node:assert/strict";
process.env.PORT = "0";
const { initialize, one, all, transaction, close, dateAdd } =
  await import("../server/db.mjs");
await initialize();
const { initializeApps, saveApp, getApp, listApps, appVersions, deleteApp } =
  await import("../server/app-store.mjs");
const { validateSpec, planApp, planAgent } =
  await import("../server/app-plans.mjs");
const { appData, previousYear } = await import("../server/app-data.mjs");
const {
  saveAgent,
  getAgent,
  runAgent,
  agentRuns,
  nextRun,
  evaluate,
  tickAgents,
  investigate,
  validateAgent,
} = await import("../server/metric-agents.mjs");
await initializeApps();
const { seedDemoHistory, historyList, historyDetail } =
  await import("../server/agent-history.mjs");
const DEMO_APP_ID = randomUUID(),
  DEMO_AGENT_ID = randomUUID();
const seed = await one("SELECT * FROM seed_info");
const spec = {
  title: "검증용 점포 분석",
  metrics: ["sales", "orders"],
  dimension: "store",
  days: 7,
  comparison: "previous",
  store: "",
  channel: "",
  chart: "bar",
};
const config = {
  name: "검증용 감시",
  frequency: "weekly",
  weekday: 1,
  time: "09:00",
  metric: "sales",
  condition: "below",
  threshold: 1e12,
  period: "rolling",
};
const ids = [];
const make = async (s = spec) => {
  const a = await saveApp({ spec: s, prompt: "테스트" });
  ids.push(a.id);
  return a;
};
after(async () => {
  for (const id of ids) await deleteApp(id);
  await close();
});
test("reject unsupported/injected specs, combinations and malformed filters", async () => {
  for (const change of [
    { metrics: ["__proto__"] },
    { metrics: ["sales", "sales"] },
    { metrics: [] },
    {
      metrics: [
        "sales",
        "orders",
        "averageOrder",
        "activeCustomers",
        "achievement",
      ],
    },
    { dimension: "category", metrics: ["appConversion"] },
    { store: "1 OR 1=1" },
    { days: NaN },
    { days: 91 },
    { channel: "web" },
    { chart: "<script>" },
    { comparison: "foo" },
    { title: " " },
  ])
    assert.throws(() => validateSpec({ ...spec, ...change }));
  await assert.rejects(appData({ ...spec, store: "999999" }));
  assert.equal(previousYear("2024-02-29"), "2023-02-28");
});
test("all grouping/metric SQL executes and reconciles with source values", async () => {
  for (const dimension of ["store", "channel", "category", "day"]) {
    const d = await appData({ ...spec, dimension });
    const raw = await one(
      "SELECT SUM(amount) sales,COUNT(*) orders FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?",
      [d.range.start, d.range.end],
    );
    assert.equal(
      d.rows.reduce((s, r) => s + r.metrics.sales.value, 0),
      raw.sales,
    );
    if (dimension !== "category")
      assert.equal(
        d.rows.reduce((s, r) => s + r.metrics.orders.value, 0),
        raw.orders,
      );
    assert.ok(d.rows.every((r) => r.metrics.sales.previous !== undefined));
  }
  for (const dimension of ["store", "channel", "day"]) {
    const d = await appData({
      ...spec,
      dimension,
      metrics: [
        "appConversion",
        "budgetExecution",
        "achievement",
        "activeCustomers",
      ],
    });
    assert.ok(d.rows.length);
    for (const r of d.rows)
      for (const m of Object.values(r.metrics))
        assert.ok(m.value === null || Number.isFinite(m.value));
  }
  const d = await appData({
    ...spec,
    metrics: ["averageOrder"],
    store: "1",
    channel: "모바일 앱",
  });
  const raw = await one(
    "SELECT 1.0*SUM(amount)/COUNT(*) v FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ? AND store_id=1 AND channel='모바일 앱'",
    [d.range.start, d.range.end],
  );
  assert.ok(Math.abs(d.rows[0].metrics.averageOrder.value - raw.v) < 0.01);
  const year = await appData({ ...spec, dimension: "day", comparison: "year" });
  const p = await one(
    "SELECT SUM(amount) sales FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?",
    [year.range.previousStart, year.range.previousEnd],
  );
  assert.equal(
    year.rows.reduce((s, r) => s + r.metrics.sales.previous, 0),
    p.sales || 0,
  );
});
test("apps persist, update optimistically, retain versions and restore as a new version", async () => {
  const app = await make();
  assert.ok((await listApps()).some((a) => a.id === app.id));
  const updated = await saveApp(
    { spec: { ...spec, title: "수정" }, version: 1, prompt: "이름 변경" },
    app.id,
  );
  assert.equal(updated.version, 2);
  await assert.rejects(
    saveApp({ spec, version: 1 }, app.id),
    (e) => e.status === 409,
  );
  const versions = await appVersions(app.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[1].spec.title, spec.title);
  const restored = await saveApp(
    { spec: versions[1].spec, version: 2, prompt: "버전 복원" },
    app.id,
  );
  assert.equal(restored.version, 3);
});
test("LLM app/agent plans validated; follow-up context included; no-key direct flow remains available", async () => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    planApp({ prompt: "점포별 매출을 보여줘", current: spec }),
    (e) => e.status === 503,
  );
  process.env.OPENAI_API_KEY = "test-not-a-real-key";
  try {
    let received;
    const p = await planApp(
      { prompt: "선 차트로 바꿔줘", current: spec },
      {
        call: async (s, input) => {
          received = input;
          return {
            supported: true,
            message: "변경 완료",
            spec: { ...spec, chart: "line" },
          };
        },
      },
    );
    assert.equal(received.current.title, spec.title);
    assert.equal(p.spec.chart, "line");
    await assert.rejects(
      planApp(
        { prompt: "고객 매출 명단 전화번호 보여줘" },
        {
          call: async () => {
            throw Error("must not call");
          },
        },
      ),
    );
    await assert.rejects(
      planApp(
        { prompt: "수익률 분석 화면 만들어줘" },
        { call: async () => ({ supported: false, message: "수익률 미지원" }) },
      ),
      /수익률/,
    );
    const p2 = await planAgent(
      { prompt: "매주 매출을 확인해줘", spec },
      { call: async () => ({ supported: true, message: "완료", config }) },
    );
    assert.equal(p2.config.time, "09:00");
    await assert.rejects(
      planApp(
        { prompt: "매출 화면을 만들어줘" },
        {
          call: async () => ({
            supported: true,
            spec: { ...spec, metrics: ["rawSql"] },
          }),
        },
      ),
    );
  } finally {
    if (saved) process.env.OPENAI_API_KEY = saved;
    else delete process.env.OPENAI_API_KEY;
  }
});
test("KST schedules and threshold/zero/null boundaries are explicit", () => {
  assert.equal(
    nextRun(config, new Date("2026-11-08T23:59:00Z")),
    "2026-11-09T00:00:00.000Z",
  );
  assert.equal(
    nextRun(config, new Date("2026-11-09T00:00:00Z")),
    "2026-11-16T00:00:00.000Z",
  );
  assert.equal(
    nextRun(
      { ...config, frequency: "daily", time: "00:05" },
      new Date("2026-11-10T15:04:00Z"),
    ),
    "2026-11-10T15:05:00.000Z",
  );
  assert.equal(
    evaluate({ value: 90, change: -10 }, { condition: "drop", threshold: 10 }),
    true,
  );
  assert.equal(
    evaluate({ value: 0, change: null }, { condition: "drop", threshold: 10 }),
    null,
  );
  assert.equal(
    evaluate({ value: 10 }, { condition: "below", threshold: 10 }),
    false,
  );
  assert.equal(
    evaluate({ value: 10 }, { condition: "above", threshold: 10 }),
    false,
  );
  for (const patch of [
    { time: "25:00" },
    { weekday: 7 },
    { threshold: -1 },
    { threshold: 101, condition: "drop" },
    { metric: "appConversion" },
  ])
    assert.throws(() => validateAgent({ ...config, ...patch }, spec));
});
test("test runs retain evidence, drill down for sales, and do not change next schedule", async () => {
  const app = await make(),
    agent = await saveAgent({ appId: app.id, config, enabled: false });
  const run = await runAgent(agent.id, {
    now: new Date(dateAdd(seed.end_date, 1) + "T01:00:00Z"),
  });
  assert.equal(run.status, "alert");
  assert.equal(run.report.appVersion, 1);
  assert.equal(run.report.investigations.length, 3);
  assert.equal(run.report.rows.length, 3);
  assert.equal((await getAgent(agent.id)).next_run, agent.next_run);
  const paused = await runAgent(agent.id, {
    kind: "scheduled",
    slot: agent.next_run,
    now: new Date(agent.next_run),
  });
  assert.equal(paused, null);
  const normal = await investigate(
    app,
    { ...config, condition: "above" },
    new Date(dateAdd(seed.end_date, 1) + "T01:00:00Z"),
  );
  assert.equal(normal.status, "normal");
  const missing = await investigate(
    app,
    config,
    new Date(dateAdd(seed.end_date, 10) + "T01:00:00Z"),
  );
  assert.equal(missing.status, "no_data");
  const weekly = await investigate(
    app,
    { ...config, period: "week" },
    new Date("2026-11-11T01:00:00Z"),
  );
  assert.equal(weekly.range.end, "2026-11-08");
  assert.equal(weekly.range.start, "2026-11-02");
});
test("scheduled runs are deduplicated, advance next run and persist after reload", async () => {
  const app = await make(),
    a = await saveAgent({ appId: app.id, config, enabled: true });
  const now = new Date(dateAdd(seed.end_date, 1) + "T01:00:00Z"),
    slot = new Date(now.getTime() - 1000).toISOString();
  await transaction((tx) =>
    tx.run("UPDATE metric_agents SET next_run=? WHERE id=?", [slot, a.id]),
  );
  await tickAgents(now);
  await tickAgents(now);
  const runs = await agentRuns(a.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].kind, "scheduled");
  assert.ok((await getAgent(a.id)).next_run > now.toISOString());
  assert.equal(await runAgent(a.id, { kind: "scheduled", slot, now }), null);
  await initializeApps();
  assert.equal((await getApp(app.id)).title, spec.title);
});
test("category investigations keep category scope and app edits preserve agent compatibility", async () => {
  const app = await make({ ...spec, dimension: "category" });
  await saveAgent({ appId: app.id, config, enabled: false });
  await assert.rejects(
    saveApp({ spec: { ...app.spec, dimension: "day" }, version: 1 }, app.id),
    (e) => e.status === 409,
  );
  const report = await investigate(
    app,
    config,
    new Date(dateAdd(seed.end_date, 1) + "T01:00:00Z"),
  );
  for (const investigation of report.investigations) {
    const hit = report.rows.find((r) => r.label === investigation.group);
    for (const detail of investigation.details)
      assert.equal(
        detail.rows.reduce((sum, r) => sum + r.value, 0),
        hit.metrics.sales.value,
      );
  }
});

test("demo history replays eight real weeks, marks provenance, remains inactive and does not alter source rows", async () => {
  const before = await one(
    "SELECT COUNT(*) count,SUM(amount) amount FROM dw_fact_orders",
  );
  const out = await seedDemoHistory({
    appId: DEMO_APP_ID,
    agentId: DEMO_AGENT_ID,
  });
  ids.push(DEMO_APP_ID);
  assert.equal(out.created, true);
  assert.equal(out.count, 9);
  const agent = await getAgent(DEMO_AGENT_ID);
  assert.equal(agent.enabled, false);
  assert.equal(agent.config.condition, "drop");
  assert.equal(agent.config.threshold, 10);
  assert.equal(agent.config.time, "09:00");
  assert.equal(agent.config.weekday, 1);
  const rows = await agentRuns(DEMO_AGENT_ID);
  assert.equal(rows.length, 9);
  assert.ok(rows.some((r) => r.status === "no_data"));
  for (const run of rows) {
    assert.equal(run.kind, "replay");
    assert.equal(run.report.replay.source, "historical_replay");
    assert.ok(new Date(run.created_at) > new Date(run.report.replay.asOf));
    const report = await investigate(
      await getApp(DEMO_APP_ID),
      agent.config,
      new Date(run.report.replay.asOf),
    );
    assert.deepEqual(run.report.rows, JSON.parse(JSON.stringify(report.rows)));
    assert.equal(run.status, report.status);
    for (const row of run.report.rows)
      assert.equal(
        row.matched,
        row.metrics.sales.change === null
          ? null
          : row.metrics.sales.change <= -10,
      );
  }
  const beforeNext = agent.next_run;
  const again = await seedDemoHistory({
    appId: DEMO_APP_ID,
    agentId: DEMO_AGENT_ID,
  });
  assert.equal(again.created, false);
  assert.equal(again.count, 9);
  assert.equal((await getAgent(DEMO_AGENT_ID)).next_run, beforeNext);
  assert.deepEqual(
    await one("SELECT COUNT(*) count,SUM(amount) amount FROM dw_fact_orders"),
    before,
  );
});
test("history filters, counts, KST record date boundaries, pagination and detail round trip", async () => {
  const p = new URLSearchParams({
    agent: DEMO_AGENT_ID,
    kind: "replay",
    pageSize: "5",
  });
  const first = await historyList(p);
  assert.equal(first.total, 9);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items.length, 5);
  p.set("page", "2");
  const second = await historyList(p);
  assert.equal(second.items.length, 4);
  assert.ok(second.items.every((r) => !first.items.some((a) => a.id === r.id)));
  assert.equal(
    Object.values(first.counts).reduce((a, b) => a + b, 0),
    9,
  );
  p.set("page", "1");
  p.set("status", "no_data");
  const withheld = await historyList(p);
  assert.ok(withheld.total >= 1);
  assert.ok(withheld.items.every((r) => r.status === "no_data"));
  const detail = await historyDetail(first.items[0].id);
  assert.equal(detail.agent_id, DEMO_AGENT_ID);
  assert.equal(detail.report.replay.source, "historical_replay");
  const day = new Date(Date.parse(detail.created_at) + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
  const today = await historyList(
    new URLSearchParams({ agent: DEMO_AGENT_ID, from: day, to: day }),
  );
  assert.equal(today.total, 9);
  const future = dateAdd(day, 1);
  assert.equal(
    (
      await historyList(
        new URLSearchParams({ agent: DEMO_AGENT_ID, from: future, to: future }),
      )
    ).total,
    0,
  );
  for (const query of [
    "page=0",
    "pageSize=51",
    "status=fake",
    "kind=unknown",
    "agent=x%27OR1",
    "from=2026-02-30",
    "from=2026-03-01&to=2026-02-01",
  ])
    await assert.rejects(historyList(new URLSearchParams(query)));
  await assert.rejects(
    historyDetail("00000000-0000-0000-0000-000000000000"),
    (e) => e.status === 404,
  );
});
test("HTTP endpoints: app lifecycle, malformed JSON, cross-origin protection, runs and cascade delete", async () => {
  const { server } = await import("../server/index.mjs");
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, data, method = "POST", headers = {}) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
  try {
    const historyResponse = await fetch(
      base + "/api/metric-agents/history?agent=" + DEMO_AGENT_ID,
    );
    assert.equal(historyResponse.status, 200);
    const savedHistory = await historyResponse.json();
    assert.equal(savedHistory.total, 9);
    assert.equal(
      (
        await fetch(
          base + "/api/metric-agents/history/" + savedHistory.items[0].id,
        )
      ).status,
      200,
    );
    assert.equal(
      (await fetch(base + "/api/metric-agents/history?pageSize=999")).status,
      400,
    );
    assert.equal(
      (
        await send("/api/metric-agents/demo", {}, "POST", {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await send("/api/my-apps", { spec }, "POST", {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/my-apps", { method: "POST", body: "{broken" }))
        .status,
      400,
    );
    assert.equal(
      (await send("/api/my-apps/preview", { spec: { ...spec, days: 999 } }))
        .status,
      400,
    );
    const response = await send("/api/my-apps", { spec });
    assert.equal(response.status, 200);
    const app = await response.json();
    const result = await fetch(base + `/api/my-apps/${app.id}/data`);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).rows.length, 3);
    const agentResponse = await send("/api/metric-agents", {
      appId: app.id,
      config,
      enabled: false,
    });
    assert.equal(agentResponse.status, 200);
    const agent = await agentResponse.json();
    assert.equal(
      (await send(`/api/metric-agents/${agent.id}/test`, {})).status,
      200,
    );
    assert.equal(
      (await fetch(base + `/api/metric-agents/${agent.id}/runs`)).status,
      200,
    );
    assert.equal(
      (await fetch(base + `/api/my-apps/${app.id}`, { method: "DELETE" }))
        .status,
      200,
    );
    assert.equal((await fetch(base + `/api/my-apps/${app.id}`)).status, 404);
    assert.equal(
      (
        await one("SELECT COUNT(*) n FROM metric_agents WHERE app_id=?", [
          app.id,
        ])
      ).n,
      0,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
