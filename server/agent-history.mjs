import { randomUUID } from "node:crypto";
import { all, one, transaction, dateAdd } from "./db.mjs";
import { bad } from "./app-plans.mjs";
import { stamp, getApp } from "./app-store.mjs";
import { investigate, nextRun } from "./metric-agents.mjs";
export const DEMO_APP_ID = "cd247e24-5fba-4a2e-85a1-06565db3c287";
export const DEMO_AGENT_ID = "edb272a4-e59b-4e16-9de7-85ac0a6262e1";
export const demoSpec = {
  title: "주간 점포 매출",
  metrics: ["sales", "orders"],
  dimension: "store",
  days: 7,
  comparison: "previous",
  store: "",
  channel: "",
  chart: "bar",
};
export const demoConfig = {
  name: "월요일 9시 · 매출 10% 감소 점검",
  frequency: "weekly",
  weekday: 1,
  time: "09:00",
  metric: "sales",
  condition: "drop",
  threshold: 10,
  period: "week",
};
const STATUSES = ["running", "alert", "normal", "no_data", "error"];
const KINDS = ["test", "scheduled", "replay"];
const decode = (r) => ({ ...r, report: JSON.parse(r.report) });
export async function historyList(params = new URLSearchParams()) {
  const page = Number(params.get("page") || 1),
    pageSize = Number(params.get("pageSize") || 10);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50
  )
    bad("페이지는 1 이상, 페이지 크기는 1~50이어야 합니다.");
  const agent = params.get("agent") || "",
    status = params.get("status") || "",
    kind = params.get("kind") || "";
  if (agent && !/^[a-f0-9-]{36}$/.test(agent))
    bad("감시 에이전트 ID를 확인하세요.");
  if (status && !STATUSES.includes(status)) bad("이력 상태를 확인하세요.");
  if (kind && !KINDS.includes(kind)) bad("실행 유형을 확인하세요.");
  const clauses = [],
    args = [];
  for (const [value, column] of [
    [agent, "r.agent_id"],
    [status, "r.status"],
    [kind, "r.kind"],
  ])
    if (value) {
      clauses.push(column + "=?");
      args.push(value);
    }
  for (const [key, operator] of [
    ["from", ">="],
    ["to", "<"],
  ]) {
    const day = params.get(key);
    if (!day) continue;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      bad("이력 조회 날짜를 확인하세요.");
    clauses.push("r.created_at" + operator + "?");
    args.push(
      new Date(
        (key === "to" ? dateAdd(day, 1) : day) + "T00:00:00+09:00",
      ).toISOString(),
    );
  }
  if (
    params.get("from") &&
    params.get("to") &&
    params.get("from") > params.get("to")
  )
    bad("시작일은 종료일보다 늦을 수 없습니다.");
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  const counts = await all(
    "SELECT r.status,COUNT(*) count FROM metric_agent_runs r" +
      where +
      " GROUP BY r.status",
    args,
  );
  const total = counts.reduce((s, r) => s + Number(r.count), 0);
  const items = await all(
    "SELECT r.*,a.name agent_name,a.app_id FROM metric_agent_runs r JOIN metric_agents a ON a.id=r.agent_id" +
      where +
      " ORDER BY r.created_at DESC,r.slot DESC,r.id DESC LIMIT ? OFFSET ?",
    [...args, pageSize, (page - 1) * pageSize],
  );
  return {
    items: items.map(decode),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    counts: Object.fromEntries(
      STATUSES.map((s) => [
        s,
        Number(counts.find((r) => r.status === s)?.count || 0),
      ]),
    ),
    queriedAt: stamp(),
  };
}
export async function historyDetail(id) {
  const r = await one(
    "SELECT r.*,a.name agent_name,a.app_id FROM metric_agent_runs r JOIN metric_agents a ON a.id=r.agent_id WHERE r.id=?",
    [id],
  );
  if (!r) bad("실행 이력을 찾을 수 없습니다.", 404);
  return decode(r);
}
async function demoResult(created, appId, agentId) {
  const app = await getApp(appId);
  const rows = await all(
    "SELECT status,COUNT(*) count FROM metric_agent_runs WHERE agent_id=? AND kind='replay' GROUP BY status",
    [agentId],
  );
  return {
    created,
    appId: app.id,
    agentId: agentId,
    count: rows.reduce((s, r) => s + Number(r.count), 0),
    counts: Object.fromEntries(rows.map((r) => [r.status, Number(r.count)])),
    message: created
      ? "최근 8주와 데이터 부족 사례를 과거 재현 이력으로 저장했습니다."
      : "이미 준비된 과거 분석 이력을 불러왔습니다. 기존 설정과 이력은 변경하지 않았습니다.",
  };
}
export async function seedDemoHistory({
  appId = DEMO_APP_ID,
  agentId = DEMO_AGENT_ID,
} = {}) {
  if (!/^[a-f0-9-]{36}$/.test(appId) || !/^[a-f0-9-]{36}$/.test(agentId))
    bad("과거 분석 묶음 ID를 확인하세요.");
  if (await one("SELECT id FROM metric_agents WHERE id=?", [agentId]))
    return demoResult(false, appId, agentId);
  if (await one("SELECT id FROM analysis_apps WHERE id=?", [appId]))
    bad(
      "과거 분석 앱만 남아 있습니다. 해당 과거 분석 앱을 삭제한 뒤 다시 준비하세요.",
      409,
    );
  const seed = await one("SELECT * FROM seed_info");
  if (!seed) bad("샘플 DB를 먼저 초기화하세요.", 409);
  const dow = new Date(seed.end_date + "T00:00:00Z").getUTCDay();
  let sunday = dateAdd(seed.end_date, -dow);
  if (new Date(dateAdd(sunday, 1) + "T09:00:00+09:00") > new Date())
    sunday = dateAdd(sunday, -7);
  const dates = Array.from(
    { length: 8 },
    (_, i) => new Date(dateAdd(sunday, 1 - 7 * i) + "T09:00:00+09:00"),
  );
  const firstDow = new Date(seed.start_date + "T00:00:00Z").getUTCDay();
  dates.push(
    new Date(dateAdd(seed.start_date, (8 - firstDow) % 7) + "T09:00:00+09:00"),
  );
  const reports = [];
  for (const asOf of dates) {
    const report = await investigate(
      { title: demoSpec.title, spec: demoSpec, version: 1 },
      demoConfig,
      asOf,
    );
    report.replay = {
      asOf: asOf.toISOString(),
      source: "historical_replay",
      description:
        "현재 샘플 DB의 과거 기간을 다시 조회한 과거 분석 이력입니다. 실제 과거 정기 실행 기록이 아닙니다.",
    };
    reports.push(report);
  }
  const now = stamp();
  try {
    await transaction(async (tx) => {
      await tx.run(
        "INSERT INTO analysis_apps (id,title,spec,version,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        [appId, demoSpec.title, JSON.stringify(demoSpec), 1, now, now],
      );
      await tx.run(
        "INSERT INTO analysis_app_versions (id,app_id,version,spec,prompt,created_at) VALUES (?,?,?,?,?,?)",
        [
          randomUUID(),
          appId,
          1,
          JSON.stringify(demoSpec),
          "주간 점포 매출 분석",
          now,
        ],
      );
      await tx.run(
        "INSERT INTO metric_agents (id,app_id,name,config,enabled,next_run,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        [
          agentId,
          appId,
          demoConfig.name,
          JSON.stringify(demoConfig),
          0,
          nextRun(demoConfig),
          now,
          now,
        ],
      );
      for (const report of reports)
        await tx.run(
          "INSERT INTO metric_agent_runs (id,agent_id,slot,kind,status,report,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            agentId,
            "demo-v1:" + report.replay.asOf,
            "replay",
            report.status,
            JSON.stringify(report),
            now,
            now,
          ],
        );
    });
  } catch (e) {
    if (
      e.code === "23505" &&
      (await one("SELECT id FROM metric_agents WHERE id=?", [agentId]))
    )
      return demoResult(false, appId, agentId);
    throw e;
  }
  return demoResult(true, appId, agentId);
}
