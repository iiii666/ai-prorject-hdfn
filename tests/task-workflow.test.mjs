import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
process.env.PORT = "0";
const { initialize, all, one, transaction, close } = await import("../server/db.mjs");
await initialize();
const { initializeApps, saveApp, deleteApp } = await import("../server/app-store.mjs");
await initializeApps();
const { initializeInvestigations, getInvestigation } = await import("../server/investigation-store.mjs");
await initializeInvestigations();
const { saveAgent, runAgent, getAgent } = await import("../server/metric-agents.mjs");
const { seedPresentationTask } = await import("../server/presentation-scenario.mjs");
const { workflowView, saveWorkflow, messageWorkflow, taskMemory } = await import("../server/task-workflow.mjs");
const { investigationStep } = await import("../server/investigation-agent.mjs");
const { taskReport, exportTaskPdf, renderTaskPdf } = await import("../server/task-report.mjs");
const apps = [];
const spec = { title: "검토 흐름 검증", metrics: ["sales", "orders"], dimension: "store", days: 7, comparison: "previous", store: "", channel: "", chart: "bar" };
const config = { name: "검토 흐름 검증", frequency: "weekly", weekday: 1, time: "09:00", metric: "sales", condition: "drop", threshold: 10, period: "week", investigationMode: "demo", objective: "점포별 감소 요인을 확인하고 다음 업무를 정리해줘." };
const app = await saveApp({ spec }); apps.push(app.id);
const agent = await saveAgent({ appId: app.id, config, enabled: false });
await seedPresentationTask(agent.id);
apps.push((await getAgent(agent.id)).app_id);
const run = await runAgent(agent.id);
const base = { runId: run.id, groupKey: "1", mode: "demo" };
let view;
after(async () => {
  for (const s of await all("SELECT id,state FROM investigation_sessions"))
    if (JSON.parse(s.state).task?.agentId === agent.id)
      await transaction((tx) => tx.run("DELETE FROM investigation_sessions WHERE id=?", [s.id]));
  for (const id of apps) await deleteApp(id);
  await close();
});
async function save(input) {
  view = await workflowView(agent.id, base);
  view = await saveWorkflow(agent.id, { ...base, version: view.review.version, ...input });
  return view;
}
test("view is read-only and rejects a run or group outside the chosen task", async () => {
  const before = await one("SELECT COUNT(*) count FROM task_reviews WHERE agent_id=?", [agent.id]);
  const draft = await workflowView(agent.id, base);
  assert.equal(draft.review.version, 0); assert.equal(draft.session, null);
  assert.equal(draft.group, "더현대 서울"); assert.equal(draft.history.length, 2);
  assert.deepEqual(await one("SELECT COUNT(*) count FROM task_reviews WHERE agent_id=?", [agent.id]), before);
  await assert.rejects(workflowView(agent.id, { ...base, runId: randomUUID() }), (e) => e.status === 404);
  await assert.rejects(workflowView(agent.id, { ...base, groupKey: "missing" }), (e) => e.status === 404);
  await assert.rejects(workflowView(agent.id, { ...base, mode: "unknown" }));
});
test("business answers persist, review versions reject lost updates, and revisiting restores progress", async () => {
  view = await save({ action: "acknowledge" });
  const version = view.review.version;
  view = await save({ action: "context", note: "지난주 모바일 할인 행사가 끝났어요." });
  assert.equal(view.review.state.acknowledged, true);
  assert.match(view.review.state.context.note, /할인 행사/);
  await assert.rejects(saveWorkflow(agent.id, { ...base, version, action: "context", note: "오래된 요청" }), (e) => e.status === 409);
  const reopened = await workflowView(agent.id, base);
  assert.equal(reopened.review.version, view.review.version);
  assert.equal(reopened.review.state.context.note, view.review.state.context.note);
});
test("inline conversation reuses verified result/history, adapts to channel request and prevents session substitution", async () => {
  view = await messageWorkflow(agent.id, { ...base, version: view.review.version, prompt: "채널별 매출 변화를 더 확인해줘" });
  let s = view.session;
  assert.ok(s.state.task.workflow); assert.match(s.state.task.businessContext.note, /행사/);
  assert.equal(s.state.rounds[0].steps[0].source, "stored_report");
  assert.equal(s.state.rounds[0].steps[1].tool, "review_task_history");
  assert.equal(s.state.rounds[0].steps[0].result.rows[0].metrics.sales.value, run.report.findings[0].metric.value);
  for (let i = 0; i < 5 && s.status === "running"; i++) s = await investigationStep(s.id, { version: s.version });
  assert.equal(s.status, "completed");
  assert.ok(s.state.rounds[0].steps.some((x) => x.dimension === "channel"));
  assert.ok(s.state.rounds[0].report.suggestedActions.length);
  assert.ok(s.state.rounds[0].report.followUpQuestion);
  await assert.rejects(messageWorkflow(agent.id, { ...base, version: view.review.version, sessionId: randomUUID(), sessionVersion: s.version, prompt: "다른 고객층도 조사해줘" }), (e) => e.status === 409);
  view = await workflowView(agent.id, base);
  assert.equal(view.session.id, s.id); assert.equal(view.session.status, "completed");
});
test("human judgment and next actions are remembered for the same group without overriding measured recovery", async () => {
  await save({ action: "judgment", judgment: "expected", note: "행사 종료에 따른 예상 변화" });
  await save({ action: "decision", kind: "contact", note: "점포 담당자에게 행사 종료일과 모바일 채널 이슈를 확인하기" });
  const memory = await taskMemory(agent.id, "1", randomUUID());
  assert.equal(memory[0].judgment, "expected"); assert.equal(memory[0].decision.kind, "contact");
  assert.deepEqual(await taskMemory(agent.id, "3", randomUUID()), []);
  const next = await runAgent(agent.id);
  assert.equal(next.report.findings[0].state, "ongoing");
  const investigation = await getInvestigation(next.report.findings[0].investigation.sessionId);
  assert.equal(investigation.state.task.memory[0].judgment, "expected");
  assert.equal(next.report.findings[0].group, "더현대 서울");
});
test("report separates facts from user input and exports a Korean multi-page PDF with stale snapshot protection", async () => {
  const unfinished = await taskReport(agent.id, { ...base, groupKey: "2" });
  assert.equal(unfinished.ready, false);
  await assert.rejects(exportTaskPdf(agent.id, { ...base, groupKey: "2", version: 0 }));
  let report = await taskReport(agent.id, base);
  assert.equal(report.ready, true); assert.equal(report.rows[0].metrics.sales.change, -18);
  assert.match(report.businessContext, /행사/); assert.equal(report.judgment, "예상된 변화");
  assert.equal(report.source, "prepared-workspace-data");
  await save({ action: "context", note: "확인이 필요한 새 업무 상황" });
  assert.equal((await taskReport(agent.id, base)).ready, false);
  await save({ action: "context", note: report.businessContext });
  report = await taskReport(agent.id, base);
  await assert.rejects(exportTaskPdf(agent.id, { ...base, version: report.reviewVersion, sessionVersion: 0 }), (e) => e.status === 409);
  const result = await exportTaskPdf(agent.id, { ...base, version: report.reviewVersion, sessionVersion: report.sessionVersion });
  assert.equal(result.download.contentType, "application/pdf");
  assert.equal(Buffer.from(result.download.bytes).subarray(0, 5).toString(), "%PDF-");
  const doc = await PDFDocument.load(result.download.bytes);
  assert.ok(doc.getPageCount() >= 2); assert.match(doc.getTitle(), /보고서/);
  const restored = await workflowView(agent.id, base);
  assert.ok(restored.review.state.lastExport);
  const longer = await renderTaskPdf({ ...report, businessContext: "긴 업무 설명과 한글 줄바꿈을 확인합니다. ".repeat(200) });
  assert.ok((await PDFDocument.load(longer)).getPageCount() > doc.getPageCount());
});
test("actual AI workflow schema receives user context and returns follow-up questions; missing key stays explicit", async () => {
  const key = process.env.OPENAI_API_KEY;
  const other = { ...base, groupKey: "2", mode: "live" };
  try {
    delete process.env.OPENAI_API_KEY;
    const empty = await workflowView(agent.id, other);
    await assert.rejects(messageWorkflow(agent.id, { ...other, version: empty.review.version, prompt: "상품군별로 더 조사해줘" }), (e) => e.status === 503);
    process.env.OPENAI_API_KEY = "test-no-provider-call";
    let w = await saveWorkflow(agent.id, { ...other, version: 0, action: "context", note: "최근 운영 시간이 바뀌었어요." });
    w = await messageWorkflow(agent.id, { ...other, version: w.review.version, prompt: "상품군별로 더 조사해줘" });
    let s = w.session;
    let calls = 0;
    const call = async (_instructions, input, schema) => {
      assert.match(input.task.businessContext.note, /운영 시간/);
      assert.ok(schema.required.includes("followUpQuestion"));
      assert.deepEqual(schema.properties.scope.properties.store.enum, [input.currentScope.store]);
      assert.deepEqual(schema.properties.scope.properties.end.enum, [input.currentScope.end]);
      assert.ok(schema.properties.nextQuery.enum.every((q) => !q.startsWith("compare_budget:")));
      calls++;
      if (calls === 1) return { kind: "tool", tool: "compare_sales", dimension: "channel", nextQuery: "compare_sales:category", scope: input.currentScope, reason: "상품 구성을 확인합니다.", text: "", evidenceIds: [] };
      assert.ok(!schema.properties.nextQuery.enum.includes("compare_sales:category"));
      return { kind: "finish", tool: "compare_sales", dimension: "store", scope: input.currentScope,
        reason: "확인된 집계에서 변화를 비교합니다.", text: "운영 변화와 매출 변동의 관계는 추가 확인이 필요합니다.",
        evidenceIds: input.citableEvidenceIds, followUpQuestion: "운영 시간이 바뀐 시점을 알려주실 수 있나요?", suggestedActions: ["compare_categories", "contact"] };
    };
    s = await investigationStep(s.id, { version: s.version }, { call });
    assert.equal(s.state.rounds[0].steps.at(-1).dimension, "category");
    s = await investigationStep(s.id, { version: s.version }, { call });
    assert.equal(s.status, "completed"); assert.match(s.state.rounds[0].report.followUpQuestion, /시점/);
    assert.deepEqual(s.state.rounds[0].report.suggestedActions, ["compare_categories", "contact"]);
  } finally { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});
test("HTTP report download is a PDF attachment and retains same-origin protection", async () => {
  const { server } = await import("../server/index.mjs");
  if (!server.listening) await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const w = await workflowView(agent.id, base);
    const report = await taskReport(agent.id, base);
    const payload = { ...base, version: w.review.version, sessionVersion: report.sessionVersion };
    const post = (origin) => fetch(`${baseUrl}/api/metric-agents/${agent.id}/report-pdf`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(payload) });
    assert.equal((await post("https://unrelated.example")).status, 403);
    const result = await post(baseUrl);
    assert.equal(result.status, 200); assert.equal(result.headers.get("content-type"), "application/pdf");
    assert.match(result.headers.get("content-disposition"), /attachment/);
    assert.equal(Buffer.from(await result.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
