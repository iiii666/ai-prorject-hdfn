import { randomUUID } from "node:crypto";
import { all, one, transaction, dateAdd, fixtureMode } from "./db.mjs";
import { bad, METRICS } from "./app-plans.mjs";
import { getApp, stamp } from "./app-store.mjs";
import { appData } from "./app-data.mjs";
import { validateDemoScenario, scenarioReport } from "./presentation-scenario.mjs";
const decode = (r) => ({
  ...r,
  config: JSON.parse(r.config),
  enabled: !!r.enabled,
});
export async function getAgent(id) {
  const r = await one("SELECT * FROM metric_agents WHERE id=?", [id]);
  if (!r) bad("감시 에이전트를 찾을 수 없습니다.", 404);
  return decode(r);
}
export async function listAgents() {
  const agents = (
    await all("SELECT * FROM metric_agents ORDER BY created_at DESC")
  ).map(decode);
  const latest = await all("SELECT agent_id,status,created_at,report FROM (SELECT agent_id,status,created_at,report,ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC,id DESC) AS rn FROM metric_agent_runs) recent WHERE rn=1");
  return agents.map((agent) => {
    const run = latest.find((r) => r.agent_id === agent.id);
    if (!run) return agent;
    const report = JSON.parse(run.report);
    return { ...agent, latestRun: { status: run.status, created_at: run.created_at,
      summary: report.summary, findings: (report.findings || []).map((f) => ({ state: f.state })) } };
  });
}
export function validateAgent(raw, spec) {
  if (
    !raw ||
    typeof raw.name !== "string" ||
    !raw.name.trim() ||
    raw.name.trim().length > 80
  )
    bad("감시 이름은 1~80자입니다.");
  if (
    !["daily", "weekly"].includes(raw.frequency) ||
    !Number.isInteger(raw.weekday) ||
    raw.weekday < 0 ||
    raw.weekday > 6 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)
  )
    bad("실행 주기와 한국 시간(HH:mm)을 확인하세요.");
  if (
    !spec.metrics.includes(raw.metric) ||
    !["drop", "below", "above"].includes(raw.condition) ||
    typeof raw.threshold !== "number" ||
    !Number.isFinite(raw.threshold) ||
    raw.threshold < 0 ||
    raw.threshold > 1000000000000
  )
    bad("감시 지표와 임계값을 확인하세요.");
  if (raw.condition === "drop" && raw.threshold > 100)
    bad("감소율은 0~100%입니다.");
  if (!["rolling", "week"].includes(raw.period)) bad("감시 기간을 확인하세요.");
  if (spec.dimension === "day")
    bad("감시는 점포별·채널별·상품군별 앱에 연결하세요.");
  const investigationMode = raw.investigationMode ?? "off";
  if (!["off", "demo", "live"].includes(investigationMode))
    bad("업무 조사 방식을 확인하세요.");
  const objective = raw.objective ?? "변화가 큰 그룹을 조사하고 확인된 사실과 추가 확인할 가설을 구분해줘.";
  if (typeof objective !== "string" || objective.trim().length < 3 || objective.length > 1000)
    bad("맡길 업무는 3~1,000자로 입력하세요.");
  const demoScenario = validateDemoScenario(raw.demoScenario, spec, investigationMode);
  return {
    name: raw.name.trim(),
    frequency: raw.frequency,
    weekday: raw.weekday,
    time: raw.time,
    metric: raw.metric,
    condition: raw.condition,
    threshold: raw.threshold,
    period: raw.period,
    investigationMode,
    objective: objective.trim(),
    ...(demoScenario ? { demoScenario } : {}),
  };
}
export function nextRun(config, after = new Date()) {
  const local = new Date(after.getTime() + 9 * 3600000);

  const date = local.toISOString().slice(0, 10);
  for (let d = 0; d <= 7; d++) {
    const day = dateAdd(date, d),
      candidate = new Date(`${day}T${config.time}:00+09:00`);
    if (
      candidate > after &&
      (config.frequency === "daily" ||
        new Date(day + "T00:00:00Z").getUTCDay() === config.weekday)
    )
      return candidate.toISOString();
  }
  throw Error("Schedule calculation failed");
}
export async function saveAgent(input, id) {
  const app = await getApp(input?.appId),
    config = validateAgent(input?.config, app.spec);
  if (typeof input.enabled !== "boolean") bad("활성화 여부를 확인하세요.");
  const old = id ? await getAgent(id) : null;
  const next = nextRun(config),
    now = stamp();
  id = id || randomUUID();
  await transaction((tx) =>
    old
      ? tx.run(
          "UPDATE metric_agents SET app_id=?,name=?,config=?,enabled=?,next_run=?,updated_at=? WHERE id=?",
          [
            app.id,
            config.name,
            JSON.stringify(config),
            Number(input.enabled),
            next,
            now,
            id,
          ],
        )
      : tx.run(
          "INSERT INTO metric_agents (id,app_id,name,config,enabled,next_run,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            id,
            app.id,
            config.name,
            JSON.stringify(config),
            Number(input.enabled),
            next,
            now,
            now,
          ],
        ),
  );
  return getAgent(id);
}
export async function deleteAgent(id) {
  await getAgent(id);
  if (
    await one(
      "SELECT id FROM metric_agent_runs WHERE agent_id=? AND status='running'",
      [id],
    )
  )
    bad("실행 완료 후 삭제하세요.", 409);
  await transaction((tx) =>
    tx.run("DELETE FROM metric_agents WHERE id=?", [id]),
  );
}
export async function agentRuns(id) {
  await getAgent(id);
  return (
    await all(
      "SELECT * FROM metric_agent_runs WHERE agent_id=? ORDER BY created_at DESC LIMIT 50",
      [id],
    )
  ).map((r) => ({ ...r, report: JSON.parse(r.report) }));
}
export function evaluate(metric, config) {
  if (metric.value === null) return null;
  if (config.condition === "drop")
    return metric.change === null ? null : metric.change <= -config.threshold;
  return config.condition === "below"
    ? metric.value < config.threshold
    : metric.value > config.threshold;
}
function endFor(config, now) {
  const today = new Date(now.getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
  if (config.period === "rolling") return dateAdd(today, -1);
  const dow = new Date(today + "T00:00:00Z").getUTCDay();
  return dateAdd(today, -(dow === 0 ? 7 : dow)); // most recent completed Monday–Sunday week
}
export async function investigate(app, config, now = new Date()) {
  validateAgent(config, app.spec);
  const spec = {
    ...app.spec,
    ...(config.period === "week" ? { days: 7, comparison: "previous" } : {}),
  };
  const data = await appData(spec, {
    end: endFor(config, now),
    strictCoverage: true,
  });
  const evaluated = data.rows.map((r) => ({
    ...r,
    matched: evaluate(r.metrics[config.metric], config),
  }));
  const hits = evaluated.filter((r) => r.matched === true);
  const investigations = [];
  if (config.metric === "sales" && (!config.investigationMode || config.investigationMode === "off"))
    for (const row of hits.slice(0, 10)) {
      const scoped = {
        ...spec,
        metrics: ["sales"],
        store: spec.dimension === "store" ? row.id : spec.store,
        channel: spec.dimension === "channel" ? row.id : spec.channel,
      };
      const details = [];
      for (const dimension of ["category", "channel"]) {
        const result = await appData(
          { ...scoped, dimension },
          {
            end: data.range.end,
            strictCoverage: true,
            gradeFilter: spec.dimension === "grade" ? row.id : undefined,
            categoryFilter:
              spec.dimension === "category" ? row.label : undefined,
          },
        );
        const decrease = result.rows
          .map((r) => ({
            label: r.label,
            value: r.metrics.sales.value,
            previous: r.metrics.sales.previous,
            difference: r.metrics.sales.difference,
          }))
          .sort((a, b) => (a.difference ?? 0) - (b.difference ?? 0));
        details.push({ dimension, rows: decrease });
      }
      investigations.push({ group: row.label, details });
    }
  const status = !data.complete
    ? "no_data"
    : hits.length
      ? "alert"
      : !evaluated.length || evaluated.some((r) => r.matched === null)
        ? "no_data"
        : "normal";
  return {
    status,
    appTitle: app.title,
    appVersion: app.version,
    spec,
    config,
    range: data.range,
    coverageStart: data.coverageStart,
    coverageEnd: data.coverageEnd,
    rows: evaluated,
    investigations,
    summary:
      status === "no_data"
        ? "데이터 또는 비교 기준이 부족하여 일부/전체 판단을 보류했습니다."
        : status === "alert"
          ? `${hits.length}개 그룹에서 감시 조건이 충족되었습니다.`
          : "감시 조건을 충족한 그룹이 없습니다.",
    alertCount: hits.length,
    notes: [
      ...data.notes,
      config.investigationMode && config.investigationMode !== "off"
        ? "추가 조사는 발견 그룹의 범위를 고정하고 결과에 따라 도구를 선택합니다. 해석은 원인을 입증하지 않습니다."
        : "추가 분석은 매출 감시에서 상품군·채널별 증감액을 조회합니다. 감소액은 기여도이며 원인을 입증하지 않습니다.",
      "지표 정의: " + METRICS[config.metric].definition,
      "보고서는 실행 시점의 앱 버전과 설정을 보관합니다.",
    ],
    steps: [
      "앱 설정 및 데이터 보유 범위 확인",
      "현재·비교 기간의 지표 집계",
      "그룹별 조건 평가",
      ...(investigations.length
        ? ["매출 변동 그룹의 상품군·채널별 추가 조회"]
        : []),
      "근거와 보고서 저장",
    ],
  };
}
export async function runAgent(
  id,
  { kind = "test", now = new Date(), slot, demoPhase = 2 } = {},
) {
  const agent = await getAgent(id),
    app = await getApp(agent.app_id);
  validateAgent(agent.config, app.spec);
  if (
    kind === "scheduled" &&
    (!agent.enabled ||
      agent.next_run > now.toISOString() ||
      slot !== agent.next_run)
  )
    return null;
  if (
    await one(
      "SELECT id FROM metric_agent_runs WHERE agent_id=? AND status='running'",
      [id],
    )
  )
    bad("이미 실행 중입니다.", 409);
  const runId = randomUUID(),
    key = kind === "scheduled" || (kind === "replay" && slot) ? slot : randomUUID();
  try {
    await transaction(async (tx) => {
      const current = await tx.one(
        "SELECT * FROM metric_agents WHERE id=?" +
          (fixtureMode ? "" : " FOR UPDATE"),
        [id],
      );
      if (!current) bad("감시 에이전트를 찾을 수 없습니다.", 404);
      if (
        kind === "scheduled" &&
        (!current.enabled || current.next_run !== slot)
      )
        bad("감시 일정이 변경되었습니다.", 409);
      if (
        await tx.one(
          "SELECT id FROM metric_agent_runs WHERE agent_id=? AND status='running'",
          [id],
        )
      )
        bad("이미 실행 중입니다.", 409);
      await tx.run(
        "INSERT INTO metric_agent_runs (id,agent_id,slot,kind,status,report,created_at) VALUES (?,?,?,?,?,?,?)",
        [runId, id, key, kind, "running", "{}", now.toISOString()],
      );
      if (kind === "scheduled")
        await tx.run(
          "UPDATE metric_agents SET next_run=?,updated_at=? WHERE id=? AND next_run=?",
          [nextRun(agent.config, now), stamp(), id, slot],
        );
    });
  } catch (e) {
    if (
      e.code === "23505" ||
      (fixtureMode && [1555, 2067].includes(e.errcode)) ||
      String(e.code).startsWith("SQLITE_CONSTRAINT")
    )
      return null;
    throw e;
  }
  try {
    const report = agent.config.demoScenario
      ? await scenarioReport(app, agent.config, demoPhase)
      : await investigate(app, agent.config, now);
    const { enrichTaskReport } = await import("./task-investigations.mjs");
    await enrichTaskReport({ agent, app, report, runId, kind, now });
    await transaction((tx) =>
      tx.run(
        "UPDATE metric_agent_runs SET status=?,report=?,finished_at=? WHERE id=?",
        [report.status, JSON.stringify(report), stamp(), runId],
      ),
    );
  } catch (e) {
    const report = {
      summary:
        e instanceof Error && e.name === "AnalysisError"
          ? e.message
          : "분석 실행에 실패했습니다. 앱 설정과 서버 로그를 확인하세요.",
      steps: ["실행 실패"],
      notes: [],
    };
    await transaction((tx) =>
      tx.run(
        "UPDATE metric_agent_runs SET status=?,report=?,finished_at=? WHERE id=?",
        ["error", JSON.stringify(report), stamp(), runId],
      ),
    );
  }
  return (await agentRuns(id)).find((r) => r.id === runId);
}
let ticking = false;
export async function tickAgents(now = new Date()) {
  if (ticking) return;
  ticking = true;
  try {
    for (const a of await all(
      "SELECT id,next_run FROM metric_agents WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 20",
      [now.toISOString()],
    )) {
      try {
        await runAgent(a.id, { kind: "scheduled", now, slot: a.next_run });
      } catch (e) {
        // Invalidated apps must not retry every 30 seconds.
        await transaction((tx) =>
          tx.run("UPDATE metric_agents SET enabled=0,updated_at=? WHERE id=?", [
            stamp(),
            a.id,
          ]),
        );
        console.error("감시 설정이 유효하지 않아 일시 중지:", a.id, e.message);
      }
    }
  } finally {
    ticking = false;
  }
}
export async function startAgentScheduler() {
  await transaction((tx) =>
    tx.run(
      "UPDATE metric_agent_runs SET status='error',report=?,finished_at=? WHERE status='running'",
      [
        JSON.stringify({
          summary:
            "서버 재시작으로 실행이 중단되었습니다. 시험 실행으로 다시 확인하세요.",
          notes: [],
        }),
        stamp(),
      ],
    ),
  );
  const poll = () =>
    tickAgents().catch((e) =>
      console.error("감시 스케줄러 오류:", e.code || e.name),
    );
  const timer = setInterval(poll, 30000);
  timer.unref();
  void poll();
  return () => clearInterval(timer);
}
