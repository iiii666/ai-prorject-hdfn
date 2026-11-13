import { all } from "./db.mjs";
import { createInvestigation } from "./investigation-store.mjs";
import { investigationStep } from "./investigation-agent.mjs";

export const MAX_TASK_INVESTIGATIONS = 3;
export function taskContextKey(spec, config) {
  return JSON.stringify([
    spec.dimension, spec.store, spec.channel, spec.days, spec.comparison,
    config.metric, config.condition, config.threshold, config.period,
    config.investigationMode || "off", config.objective || "",
  ]);
}
const unresolved = (f) => ["new", "ongoing", "deferred"].includes(f.state);

// Lifecycle decisions use verified aggregates, never the model's interpretation.
export function trackFindings(report, previous, now) {
  const old = previous?.report.findings || [];
  const prior = new Map(old.filter(unresolved).map((f) => [f.key, f]));
  const rows = new Map((report.rows || []).map((r) => [r.id, r]));
  const findings = [];
  for (const row of report.rows || []) {
    if (!row.matched) continue;
    const before = prior.get(row.id);
    findings.push({
      key: row.id, group: row.label,
      state: before ? "ongoing" : "new",
      firstSeen: before?.firstSeen || now,
      lastSeen: now,
      metric: row.metrics[report.config.metric],
      previousMetric: before?.metric || null,
      previousRunId: before ? previous.id : null,
    });
  }
  for (const before of prior.values()) {
    if (findings.some((f) => f.key === before.key)) continue;
    const row = rows.get(before.key);
    const recovered = report.status !== "no_data" && row?.matched === false;
    findings.push({
      key: before.key, group: before.group,
      state: recovered ? "recovered" : "deferred",
      firstSeen: before.firstSeen, lastSeen: recovered ? now : before.lastSeen,
      metric: row?.metrics[report.config.metric] || null,
      previousMetric: before.metric,
      previousRunId: previous.id,
    });
  }
  return findings;
}

export async function runTaskInvestigation(input, dependencies = {}) {
  const { agent, app, report, finding, runId, previous } = input;
  const mode = agent.config.investigationMode || "off";
  if (mode === "off") return { mode, status: "off" };
  if (mode === "live" && !process.env.OPENAI_API_KEY && !dependencies.step)
    return { mode, status: "unavailable", summary: "AI 키가 설정되지 않아 자동 조사를 실행하지 못했습니다." };
  const scope = {
    days: report.spec.days, end: report.range.end,
    store: app.spec.dimension === "store" ? finding.key : app.spec.store,
    channel: app.spec.dimension === "channel" ? finding.key : app.spec.channel,
    comparison: report.spec.comparison,
  };
  const filters = {
    ...(app.spec.dimension === "grade" ? { gradeFilter: finding.key } : {}),
    ...(app.spec.dimension === "category" ? { categoryFilter: finding.key } : {}),
  };
  let session;
  try {
    session = await (dependencies.create || createInvestigation)({
      mode, scope,
      prompt: finding.group + " 그룹의 매출·지표 변화를 조사하고, 확인 사실과 추가 확인할 가설을 정리해줘.",
    }, { task: {
      agentId: agent.id, runId, group: finding.group, filters,
      objective: agent.config.objective,
      trigger: { metric: agent.config.metric, condition: agent.config.condition,
        threshold: agent.config.threshold, observation: finding.metric },
      previous: previous ? {
        state: finding.state, metric: finding.previousMetric,
        range: previous.report.range,
        summary: previous.report.findings?.find((f) => f.key === finding.key)?.investigation?.summary,
      } : null,
    } });
    const roundId = session.state.rounds.at(-1).id;
    const step = dependencies.step || investigationStep;
    // Browser-independent runner. investigationStep enforces the query and model budgets.
    for (let i = 0; i < 8 && session.status === "running"; i++) {
      session = await step(session.id, { version: session.version });
      if (session.state.rounds.at(-1).id !== roundId)
        return { mode, sessionId: session.id, status: "interrupted", summary: "사용자 후속 요청으로 자동 조사를 넘겼습니다." };
    }
    if (session.status === "running") {
      const { pauseInvestigation } = await import("./investigation-agent.mjs");
      session = await pauseInvestigation(session.id, { version: session.version });
    }
    const round = session.state.rounds.at(-1);
    return {
      mode, sessionId: session.id, status: session.status,
      summary: round.report?.summary || round.error || "추가 확인이 필요합니다. 조사 대화에서 이어갈 수 있습니다.",
      queryCount: round.steps.length,
    };
  } catch (error) {
    if (session) {
      const { getInvestigation } = await import("./investigation-store.mjs");
      const { pauseInvestigation } = await import("./investigation-agent.mjs");
      try {
        const latest = await getInvestigation(session.id);
        if (latest.version === session.version && latest.status === "running")
          await pauseInvestigation(session.id, { version: latest.version });
      } catch { /* Preserve the original failure; another reader may have intervened. */ }
    }
    return {
      mode, status: "error", ...(session ? { sessionId: session.id } : {}),
      summary: "자동 조사를 완료하지 못했습니다. 조사 대화에서 다시 확인하세요.",
    };
  }
}

export function prioritizeInvestigations(findings, previous) {
  const wasLimited = (finding) => previous?.report.findings?.find((f) => f.key === finding.key)?.investigation?.status === "limited" ? 1 : 0;
  return findings.filter((f) => ["new", "ongoing"].includes(f.state))
    .sort((a, b) => wasLimited(b) - wasLimited(a) ||
      Math.abs(b.metric?.difference || 0) - Math.abs(a.metric?.difference || 0));
}

export async function enrichTaskReport({ agent, app, report, runId, kind, now }, dependencies = {}) {
  report.contextKey = taskContextKey(app.spec, agent.config);
  // Tests, historical replays and scheduled observations never share a baseline.
  const history = await all(
    "SELECT id,report FROM metric_agent_runs WHERE agent_id=? AND kind=? AND id<>? AND status IN ('normal','alert','no_data') AND created_at<=? ORDER BY created_at DESC,id DESC LIMIT 1",
    [agent.id, kind, runId, now.toISOString()],
  );
  const latest = history[0] ? { ...history[0], report: JSON.parse(history[0].report) } : null;
  const previous = latest?.report.contextKey === report.contextKey ? latest : null;
  report.findings = trackFindings(report, previous, now.toISOString());
  const priority = { new: 0, ongoing: 1, recovered: 2, deferred: 3 };
  report.findings.sort((a, b) => priority[a.state] - priority[b.state] ||
    Math.abs(b.metric?.difference || 0) - Math.abs(a.metric?.difference || 0));
  const candidates = prioritizeInvestigations(report.findings, previous);
  for (const [index, finding] of candidates.entries()) {
    finding.investigation = (agent.config.investigationMode || "off") === "off"
      ? { mode: "off", status: "off" }
      : index < MAX_TASK_INVESTIGATIONS
      ? await runTaskInvestigation({ agent, app, report, finding, runId, previous }, dependencies)
      : { mode: agent.config.investigationMode || "off", status: "limited", summary: "실행당 최대 세 그룹까지 조사합니다. 다음 실행 또는 대화에서 확인하세요." };
  }
  report.taskMode = agent.config.investigationMode || "off";
  report.steps.push("이전 동일 업무의 발견사항과 비교하여 지속·회복 여부 확인");
  if (report.taskMode !== "off" && candidates.length)
    report.steps.push("발견 그룹별 도구 선택 조사 실행 및 대화·근거 보관");
  const counts = Object.fromEntries(["new", "ongoing", "recovered", "deferred"].map((s) => [s, report.findings.filter((f) => f.state === s).length]));
  report.summary = report.findings.length
    ? `새로 발견 ${counts.new}건 · 지속 중 ${counts.ongoing}건 · 회복 ${counts.recovered}건 · 판단 보류 ${counts.deferred}건`
    : report.summary;
}
