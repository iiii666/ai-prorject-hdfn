import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { initialize, one, transaction, close, dateAdd } = await import("../server/db.mjs");
await initialize();
const { initializeApps, saveApp, deleteApp } = await import("../server/app-store.mjs");
await initializeApps();
const { initializeInvestigations, createInvestigation, getInvestigation } = await import("../server/investigation-store.mjs");
await initializeInvestigations();
const { investigationStep, sendInvestigationMessage } = await import("../server/investigation-agent.mjs");
const { runAgent, saveAgent, listAgents, validateAgent, investigate } = await import("../server/metric-agents.mjs");
const { trackFindings, runTaskInvestigation, enrichTaskReport } = await import("../server/task-investigations.mjs");
const { appData } = await import("../server/app-data.mjs");
const seed = await one("SELECT * FROM seed_info");
const now = new Date(dateAdd(seed.end_date, 1) + "T12:00:00+09:00");
const spec = { title: "업무 검증", metrics: ["sales", "orders"], dimension: "store", days: 7, comparison: "previous", store: "", channel: "", chart: "bar" };
const config = { name: "업무 검증", frequency: "weekly", weekday: 1, time: "09:00", metric: "sales", condition: "below", threshold: 1e12, period: "rolling", investigationMode: "demo", objective: "점포 매출을 조사하고 지난 발견사항의 경과도 확인해줘." };
const apps = [], sessions = [];
const create = async (...args) => { const s = await createInvestigation(...args); sessions.push(s.id); return s; };
const make = async (patch = {}) => {
  const app = await saveApp({ spec: { ...spec, ...patch }, prompt: "업무 검증" }); apps.push(app.id); return app;
};
after(async () => {
  // runAgent's background sessions are also owned by these test apps' agents.
  const { all } = await import("../server/db.mjs");
  const agentIds = (await listAgents()).filter((a) => apps.includes(a.app_id)).map((a) => a.id);
  for (const s of await all("SELECT id,state FROM investigation_sessions"))
    if (agentIds.includes(JSON.parse(s.state).task?.agentId)) sessions.push(s.id);
  for (const id of new Set(sessions)) await transaction((tx) => tx.run("DELETE FROM investigation_sessions WHERE id=?", [id]));
  for (const id of apps) await deleteApp(id);
  await close();
});
const metric = { value: 80, previous: 100, change: -20, difference: -20 };
const report = (matched, status = "alert") => ({ status, config: { metric: "sales" }, rows: matched === undefined ? [] : [{ id: "x", label: "강남점", matched, metrics: { sales: metric } }] });

test("finding lifecycle distinguishes sustained, recovered, missing and reopened observations", () => {
  const first = trackFindings(report(true), null, "2026-01-01");
  assert.equal(first[0].state, "new");
  const previous = { id: "r1", report: { findings: first } };
  const ongoing = trackFindings(report(true), previous, "2026-01-08");
  assert.equal(ongoing[0].state, "ongoing");
  assert.equal(ongoing[0].firstSeen, "2026-01-01");
  assert.equal(ongoing[0].previousRunId, "r1");
  const recovered = trackFindings(report(false, "normal"), previous, "2026-01-08");
  assert.equal(recovered[0].state, "recovered");
  for (const r of [report(undefined, "no_data"), report(null), report(undefined, "normal")]) {
    const deferred = trackFindings(r, previous, "2026-01-08");
    assert.equal(deferred[0].state, "deferred");
    assert.equal(deferred[0].lastSeen, "2026-01-01");
  }
  assert.equal(trackFindings(report(true), { id: "r2", report: { findings: recovered } }, "2026-01-15")[0].state, "new");
  assert.deepEqual(trackFindings(report(false, "normal"), { id: "r2", report: { findings: recovered } }, "2026-01-15"), []);
});

test("legacy agents remain rule-based and invalid task modes and objectives are rejected", () => {
  assert.equal(validateAgent({ ...config, investigationMode: undefined }, spec).investigationMode, "off");
  for (const patch of [{ investigationMode: "fake-ai" }, { objective: "" }, { objective: "x".repeat(1001) }])
    assert.throws(() => validateAgent({ ...config, ...patch }, spec));
});

test("server-driven demo stores scoped evidence and supports a follow-up in the same session", async () => {
  const app = await make({ dimension: "grade", channel: "모바일 앱" });
  const r = await investigate(app, config, now);
  const row = r.rows[0];
  const result = await runTaskInvestigation({ agent: { id: randomUUID(), config }, app, report: r, finding: { key: row.id, group: row.label }, runId: randomUUID() }, { create });
  assert.equal(result.status, "completed");
  assert.equal(result.mode, "demo");
  let session = await getInvestigation(result.sessionId);
  const round = session.state.rounds[0];
  assert.equal(session.state.task.filters.gradeFilter, row.id);
  const expected = await appData({ ...app.spec, metrics: ["sales"], end: r.range.end }, { strictCoverage: true, gradeFilter: row.id });
  assert.equal(round.steps[0].result.rows.reduce((n, r) => n + r.metrics.sales.value, 0), expected.rows.reduce((n, r) => n + r.metrics.sales.value, 0));
  assert.ok(round.report.evidenceIds.length);
  session = await sendInvestigationMessage(session.id, { version: session.version, prompt: "상품군별 매출도 더 봐줘" });
  assert.equal(session.state.rounds.length, 2);
  assert.equal(session.state.task.filters.gradeFilter, row.id);
});

test("live runner consumes tool observations, passes prior context, and rejects scope drift", async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-provider-not-called";
  try {
    const app = await make();
    const r = await investigate(app, config, now);
    const row = r.rows[0];
    let calls = 0;
    const call = async (_instructions, input) => {
      calls++;
      assert.equal(input.task.group, row.label);
      assert.equal(input.task.previous.state, "ongoing");
      return { kind: calls < 3 ? "tool" : "finish", tool: "compare_sales", dimension: calls === 1 ? "store" : "category", scope: input.currentScope, reason: "매출 변화를 확인합니다.", text: "주문과 상품군의 변화를 확인했습니다. 추가 원인 검증이 필요합니다.", evidenceIds: input.evidence.map((e) => e.id) };
    };
    const args = { agent: { id: randomUUID(), config: { ...config, investigationMode: "live" } }, app, report: r, finding: { key: row.id, group: row.label, state: "ongoing", previousMetric: metric }, runId: randomUUID(), previous: { report: { range: r.range, findings: [] } } };
    const result = await runTaskInvestigation(args, { create, step: (id, input) => investigationStep(id, input, { call }) });
    assert.equal(result.status, "completed");
    assert.equal(result.queryCount, 2);
    assert.equal(calls, 3);
    const drift = await runTaskInvestigation(args, { create, step: (id, input) => investigationStep(id, input, { call: async (_i, q) => ({ kind: "tool", tool: "compare_sales", scope: { ...q.currentScope, store: "" }, dimension: "channel", reason: "범위 변경", text: "" }) }) });
    assert.equal(drift.status, "error");
    assert.equal(drift.queryCount, 0);
    assert.match(drift.summary, /범위/);
  } finally { if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});

test("missing key never turns into a fake successful AI run and provider failure leaves no running session", async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const app = await make();
  const r = await investigate(app, config, now);
  const row = r.rows[0];
  const args = { agent: { id: randomUUID(), config: { ...config, investigationMode: "live" } }, app, report: r, finding: { key: row.id, group: row.label }, runId: randomUUID() };
  try {
    const missing = await runTaskInvestigation(args);
    assert.equal(missing.status, "unavailable");
    assert.equal(missing.sessionId, undefined);
    process.env.OPENAI_API_KEY = "test-only-provider-not-called";
    const failed = await runTaskInvestigation(args, { create, step: async () => { throw Error("provider failure"); } });
    assert.equal(failed.status, "error");
    assert.equal((await getInvestigation(failed.sessionId)).status, "paused");
  } finally { if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});

test("persisted task runs track continuity, isolate changed settings and execution kinds, and cap investigations", async () => {
  const app = await make();
  const agent = await saveAgent({ appId: app.id, config, enabled: false });
  const first = await runAgent(agent.id, { now });
  assert.equal(first.status, "alert");
  assert.ok(first.report.findings.every((f) => f.state === "new"));
  assert.ok(first.report.findings.filter((f) => f.investigation.sessionId).length <= 3);
  assert.ok(first.report.findings.some((f) => f.investigation.status === "completed"));
  const second = await runAgent(agent.id, { now: new Date(now.getTime() + 1000) });
  assert.ok(second.report.findings.every((f) => f.state === "ongoing"));
  assert.ok(second.report.findings.every((f) => f.previousRunId === first.id));
  const latest = (await listAgents()).find((a) => a.id === agent.id).latestRun;
  assert.ok(latest.findings.every((f) => f.state === "ongoing"));
  const changed = await saveAgent({ appId: app.id, config: { ...config, threshold: 9e11 }, enabled: false }, agent.id);
  const third = await runAgent(agent.id, { now: new Date(now.getTime() + 2000) });
  assert.ok(third.report.findings.every((f) => f.state === "new"));
  const scheduled = await investigate(app, changed.config, now);
  await enrichTaskReport({ agent: changed, app, report: scheduled, runId: randomUUID(), kind: "scheduled", now }, { create });
  assert.ok(scheduled.findings.every((f) => f.state === "new"));
  const missing = await runAgent(agent.id, { now: new Date(dateAdd(seed.end_date, 100) + "T12:00:00+09:00") });
  assert.equal(missing.status, "no_data");
  assert.ok(missing.report.findings.length);
  assert.ok(missing.report.findings.every((f) => f.state === "deferred"));
});

test("restricted customer/category tasks reject tools that cannot preserve those filters", async () => {
  const { executeTool, defaultScope } = await import("../server/investigation-tools.mjs");
  for (const tool of ["compare_budget", "compare_app_conversion"])
    await assert.rejects(executeTool(tool, await defaultScope(), "store", { gradeFilter: "VIP" }), /지원하지/);
});

test("server runner stops at its decision budget and hands off when the user sends a new round", async () => {
  const app = await make();
  const r = await investigate(app, config, now);
  const row = r.rows[0];
  const args = { agent: { id: randomUUID(), config }, app, report: r, finding: { key: row.id, group: row.label }, runId: randomUUID() };
  let calls = 0;
  const bounded = await runTaskInvestigation(args, { create, step: async (id) => { calls++; return getInvestigation(id); } });
  assert.equal(calls, 8);
  assert.equal(bounded.status, "paused");
  assert.equal((await getInvestigation(bounded.sessionId)).status, "paused");
  calls = 0;
  const handoff = await runTaskInvestigation(args, { create, step: async (id, input) => {
    calls++;
    return sendInvestigationMessage(id, { version: input.version, prompt: "모바일 쪽만 더 봐줘" });
  } });
  assert.equal(calls, 1);
  assert.equal(handoff.status, "interrupted");
  assert.equal((await getInvestigation(handoff.sessionId)).state.rounds.length, 2);
});

test("previously limited findings get a turn and rule-only tasks never claim an AI investigation limit", async () => {
  const { prioritizeInvestigations } = await import("../server/task-investigations.mjs");
  const findings = [
    { key: "large", state: "ongoing", metric: { difference: -100 } },
    { key: "waiting", state: "ongoing", metric: { difference: -1 } },
    { key: "recovered", state: "recovered", metric: { difference: -200 } },
  ];
  const ordered = prioritizeInvestigations(findings, { report: { findings: [{ key: "waiting", investigation: { status: "limited" } }] } });
  assert.deepEqual(ordered.map((f) => f.key), ["waiting", "large"]);
  const r = { ...report(true), spec, steps: [], rows: Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: String(i), matched: true, metrics: { sales: metric } })) };
  await enrichTaskReport({ agent: { id: randomUUID(), config: { ...config, investigationMode: "off" } }, app: { spec }, report: r, runId: randomUUID(), kind: "test", now });
  assert.equal(r.findings.length, 5);
  assert.ok(r.findings.every((f) => f.investigation.status === "off"));
});

test("presentation scenario has two prior weeks, one historical declining store and a different current store", async () => {
  const { scenarioReport, scenarioData, PRESENTATION_SCENARIO } = await import("../server/presentation-scenario.mjs");
  const demoScenario = { id: PRESENTATION_SCENARIO, anchorEnd: seed.end_date };
  const c = { ...config, condition: "drop", threshold: 10, demoScenario };
  const before = await one("SELECT COUNT(*) count,SUM(amount) total FROM dw_fact_orders");
  const reports = [];
  for (const phase of [0, 1, 2]) reports.push(await scenarioReport({ title: spec.title, version: 1, spec }, c, phase));
  assert.deepEqual(reports.map((r) => r.alertCount), [0, 1, 1]);
  assert.equal(reports[1].rows.find((r) => r.matched).label, "판교점");
  assert.equal(reports[2].rows.find((r) => r.matched).label, "더현대 서울");
  assert.equal(reports[1].rows.find((r) => r.matched).metrics.sales.change, -16);
  assert.equal(reports[2].rows.find((r) => r.matched).metrics.sales.change, -18);
  assert.ok(reports.slice(0, 2).every((r) => r.replay.source === "synthetic_scenario"));
  for (const phase of [0, 1, 2]) {
    const source = { ...demoScenario, phase };
    const total = reports[phase].rows.reduce((n, r) => n + r.metrics.sales.value, 0);
    for (const dimension of ["channel", "category", "grade", "day"]) {
      const d = await scenarioData({ ...spec, metrics: ["sales"], dimension }, source);
      assert.equal(d.rows.reduce((n, r) => n + r.metrics.sales.value, 0), total);
      assert.match(d.notes[0], /合成|합성/);
    }
    if (phase) for (const row of reports[phase].rows)
      assert.equal(row.metrics.sales.previous, reports[phase - 1].rows.find((r) => r.id === row.id).metrics.sales.value);
  }
  assert.deepEqual(await one("SELECT COUNT(*) count,SUM(amount) total FROM dw_fact_orders"), before);
  assert.throws(() => validateAgent({ ...c, investigationMode: "live" }, spec), /시연/);
});

test("presentation history seeds idempotently, now-check yields one different store, and follow-up evidence stays synthetic", async () => {
  const { seedPresentationTask } = await import("../server/presentation-scenario.mjs");
  const { agentRuns } = await import("../server/metric-agents.mjs");
  const { workspaceApi } = await import("../server/workspace-api.mjs");
  const app = await make();
  const agent = await saveAgent({ appId: app.id, config, enabled: false });
  const seeded = await seedPresentationTask(agent.id);
  const current = (await listAgents()).find((a) => a.id === agent.id);
  apps.push(current.app_id);
  assert.notEqual(current.app_id, app.id);
  assert.equal(current.enabled, false);
  assert.equal(current.config.investigationMode, "demo");
  assert.equal(seeded.historyCount, 2);
  assert.equal((await seedPresentationTask(agent.id)).historyCount, 2);
  const history = await agentRuns(agent.id);
  assert.deepEqual(history.map((r) => r.report.alertCount).sort(), [0, 1]);
  const historicalAlert = history.find((r) => r.report.alertCount === 1);
  assert.equal(historicalAlert.report.findings[0].firstSeen, historicalAlert.report.replay.asOf);
  const run = await runAgent(agent.id);
  assert.equal(run.report.alertCount, 1);
  assert.equal(run.report.findings.length, 1);
  assert.equal(run.report.findings[0].group, "더현대 서울");
  const investigation = run.report.findings[0].investigation;
  assert.equal(investigation.status, "completed");
  const s = await getInvestigation(investigation.sessionId);
  assert.ok(s.state.task.demonstration);
  const steps = s.state.rounds[0].steps;
  assert.ok(steps.every((s) => s.result.demonstration));
  assert.equal(steps[0].result.rows[0].metrics.sales.value, run.report.findings[0].metric.value);
  assert.equal(steps[1].result.rows.reduce((n, r) => n + r.metrics.sales.value, 0), run.report.findings[0].metric.value);
  const view = await workspaceApi(`/api/my-apps/${current.app_id}/data`, "GET");
  assert.ok(view.demonstration);
  assert.equal(view.rows.find((r) => r.id === "1").metrics.sales.value, run.report.findings[0].metric.value);
  const oldView = await workspaceApi(`/api/my-apps/${app.id}/data`, "GET");
  assert.equal(oldView.demonstration, undefined);
});
