import { randomUUID } from "node:crypto";
import { all, one, transaction, fixtureMode } from "./db.mjs";
import { bad } from "./app-plans.mjs";
import { getAgent, agentRuns } from "./metric-agents.mjs";
import { createInvestigation, getInvestigation, persistInvestigation, promptText } from "./investigation-store.mjs";
import { sendInvestigationMessage } from "./investigation-agent.mjs";

const emptyState = () => ({ acknowledged: false, context: null, judgment: "unreviewed", judgmentNote: "", decision: null, threads: {} });
const text = (value, max = 1600) => {
  if (typeof value !== "string" || value.length > max) bad(`내용은 ${max}자 이내로 입력하세요.`);
  return value.trim();
};
export async function reviewContext(agentId, input) {
  const agent = await getAgent(agentId);
  const runs = await agentRuns(agentId);
  const run = runs.find((r) => r.id === input.runId);
  if (!run || !run.report.range || !run.report.spec || !["normal", "alert"].includes(run.status))
    bad("분석이 완료된 업무 실행 결과를 선택하세요.", 404);
  const groupKey = input.groupKey ?? "";
  if (typeof groupKey !== "string" || groupKey.length > 100) bad("조사 대상을 확인하세요.");
  const row = groupKey ? run.report.rows?.find((r) => r.id === groupKey) : null;
  if (groupKey && !row) bad("해당 실행 결과에 없는 조사 대상입니다.", 404);
  const spec = run.report.spec;
  const group = row?.label || "전체 업무";
  const scope = { days: spec.days, end: run.report.range.end, comparison: spec.comparison,
    store: row && spec.dimension === "store" ? row.id : spec.store,
    channel: row && spec.dimension === "channel" ? row.id : spec.channel };
  const filters = {
    ...(row && spec.dimension === "grade" ? { gradeFilter: row.id } : {}),
    ...(row && spec.dimension === "category" ? { categoryFilter: row.id } : {}),
  };
  const history = runs.filter((r) => r.id !== run.id && r.report.range &&
    r.report.range.end < run.report.range.end &&
    r.report.spec?.dimension === spec.dimension && r.report.spec?.store === spec.store &&
    r.report.spec?.channel === spec.channel &&
    r.report.spec?.days === spec.days && r.report.spec?.comparison === spec.comparison &&
    r.report.config?.metric === run.report.config?.metric &&
    r.report.config?.condition === run.report.config?.condition &&
    r.report.config?.threshold === run.report.config?.threshold &&
    (r.report.demonstration?.id || "") === (run.report.demonstration?.id || ""))
    .sort((a, b) => b.report.range.end.localeCompare(a.report.range.end))
    .filter((r, i, rows) => rows.findIndex((x) => x.report.range.end === r.report.range.end) === i).slice(0, 3)
    .map((r) => ({ runId: r.id, range: r.report.range, summary: r.report.summary,
      rows: r.report.rows || [], findings: r.report.findings || [] }));
  return { agent, run, row, groupKey, group, scope, filters, history };
}
async function storedReview(context) {
  const row = await one("SELECT * FROM task_reviews WHERE agent_id=? AND run_id=? AND group_key=?",
    [context.agent.id, context.run.id, context.groupKey]);
  return row ? { ...row, state: JSON.parse(row.state) } : { id: randomUUID(), agent_id: context.agent.id,
    run_id: context.run.id, group_key: context.groupKey, version: 0, state: emptyState(), updated_at: null };
}
async function persistReview(review, expected) {
  if (review.version !== expected) bad("검토 내용이 바뀌었습니다. 최신 내용을 다시 불러오세요.", 409);
  const now = new Date().toISOString();
  try {
    await transaction(async (tx) => {
      if (!expected) await tx.run("INSERT INTO task_reviews (id,agent_id,run_id,group_key,state,version,updated_at) VALUES (?,?,?,?,?,?,?)",
        [review.id, review.agent_id, review.run_id, review.group_key, JSON.stringify(review.state), 1, now]);
      else {
        const result = await tx.run("UPDATE task_reviews SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          [JSON.stringify(review.state), now, review.id, expected]);
        if (!(fixtureMode ? result.changes : result[0].affectedRows)) bad("다른 검토가 저장되었습니다. 다시 불러오세요.", 409);
      }
    });
  } catch (e) {
    if (e.code === "23505" || (fixtureMode && [1555, 2067].includes(e.errcode))) bad("다른 검토가 저장되었습니다. 다시 불러오세요.", 409);
    throw e;
  }
  return { ...review, version: expected + 1, updated_at: now };
}
export async function taskMemory(agentId, groupKey, excludeRunId) {
  const rows = await all("SELECT run_id,group_key,state,updated_at FROM task_reviews WHERE agent_id=? AND (group_key=? OR group_key='') AND run_id<>? ORDER BY updated_at DESC LIMIT 5",
    [agentId, groupKey, excludeRunId]);
  return rows.map((r) => {
    const state = JSON.parse(r.state);
    return { runId: r.run_id, groupKey: r.group_key, context: state.context, judgment: state.judgment,
      judgmentNote: state.judgmentNote, decision: state.decision, at: r.updated_at };
  });
}
export async function workflowView(agentId, input) {
  const context = await reviewContext(agentId, input);
  const review = await storedReview(context);
  const mode = input.mode || "demo";
  if (!["live", "demo"].includes(mode)) bad("대화 방식을 확인하세요.");
  let session = null;
  const id = review.state.threads[mode];
  if (id) {
    session = await getInvestigation(id);
    if (session.state.task?.agentId !== agentId || session.state.task?.runId !== context.run.id ||
      session.state.task?.groupKey !== context.groupKey) bad("업무 대화 연결을 확인하세요.", 409);
  }
  return { review, session, group: context.group, history: context.history,
    memory: await taskMemory(agentId, context.groupKey, context.run.id) };
}
export async function saveWorkflow(agentId, input) {
  const context = await reviewContext(agentId, input);
  const review = await storedReview(context);
  if (!Number.isInteger(input.version)) bad("검토 버전을 확인하세요.");
  switch (input.action) {
    case "acknowledge": review.state.acknowledged = true; break;
    case "context": review.state.context = { note: text(input.note), at: new Date().toISOString() }; break;
    case "judgment":
      if (!["unreviewed", "expected", "important", "resolved"].includes(input.judgment)) bad("업무 판단을 확인하세요.");
      review.state.judgment = input.judgment;
      review.state.judgmentNote = text(input.note || "", 500); break;
    case "decision":
      if (!["investigate", "follow_up", "contact"].includes(input.kind)) bad("다음 행동을 선택하세요.");
      review.state.decision = { kind: input.kind, note: text(input.note || "", 1000), at: new Date().toISOString() }; break;
    default: bad("저장할 검토 내용을 확인하세요.");
  }
  await persistReview(review, input.version);
  return workflowView(agentId, input);
}
export async function messageWorkflow(agentId, input) {
  const context = await reviewContext(agentId, input);
  const review = await storedReview(context);
  const prompt = promptText(input.prompt);
  if (!Number.isInteger(input.version) || review.version !== input.version)
    bad("검토 내용이 바뀌었습니다. 다시 불러오세요.", 409);
  const mode = input.mode;
  if (!["live", "demo"].includes(mode)) bad("대화 방식을 확인하세요.");
  let session;
  const existingId = review.state.threads[mode];
  if (existingId) {
    session = await getInvestigation(existingId);
    if (session.id !== input.sessionId || session.state.task?.agentId !== agentId ||
        session.state.task?.runId !== context.run.id || session.state.task?.groupKey !== context.groupKey)
      bad("선택한 업무의 대화를 다시 불러오세요.", 409);
    // A refreshed business answer becomes context for the next model decision.
    session.state.task.businessContext = review.state.context;
    session.state.task.judgment = review.state.judgment;
    if (session.version !== input.sessionVersion) bad("대화가 바뀌었습니다. 다시 불러오세요.", 409);
    session = await persistInvestigation(session, session.version);
    session = await sendInvestigationMessage(session.id, { version: session.version, prompt });
  } else {
    session = await createInvestigation({ mode, prompt, scope: context.scope }, { task: {
      workflow: true, agentId, runId: context.run.id, groupKey: context.groupKey, group: context.group,
      filters: context.filters, objective: context.agent.config.objective,
      businessContext: review.state.context, judgment: review.state.judgment,
      memory: await taskMemory(agentId, context.groupKey, context.run.id),
      ...(context.run.report.demonstration ? { demonstration: context.run.report.demonstration } : {}),
    } });
    // Reuse immutable server aggregates rather than asking the model to invent a briefing.
    const snapshot = { spec: context.run.report.spec, range: context.run.report.range,
      rows: context.row ? [context.row] : context.run.report.rows, complete: true,
      queriedAt: context.run.created_at, notes: [],
      ...(context.run.report.demonstration ? { demonstration: context.run.report.demonstration } : {}) };
    const initial = session.state.rounds[0];
    initial.steps.push({ id: randomUUID(), tool: "read_task_result", dimension: context.run.report.spec.dimension,
      reason: "선택한 업무의 실행 결과를 확인합니다.", scope: context.scope, result: snapshot,
      source: "stored_report", at: new Date().toISOString() });
    if (context.history.length) initial.steps.push({ id: randomUUID(), tool: "review_task_history", dimension: "store",
      reason: "같은 업무의 이전 실행과 발견사항을 확인합니다.", scope: context.scope,
      result: { ...snapshot, rows: [], history: context.history }, source: "stored_report", at: new Date().toISOString() });
    session = await persistInvestigation(session, session.version);
    review.state.threads[mode] = session.id;
    try { await persistReview(review, input.version); }
    catch (e) { await transaction((tx) => tx.run("DELETE FROM investigation_sessions WHERE id=?", [session.id])); throw e; }
  }
  return workflowView(agentId, input);
}
export async function recordReportExport(agentId, input, metadata) {
  const context = await reviewContext(agentId, input);
  const review = await storedReview(context);
  review.state.lastExport = metadata;
  return persistReview(review, input.version);
}
