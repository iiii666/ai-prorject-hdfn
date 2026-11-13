import { all, one, dateAdd } from "./db.mjs";
import { ranges } from "./app-data.mjs";
import { bad } from "./app-plans.mjs";
export const PRESENTATION_SCENARIO = "two-week-sales-v1";
export const SCENARIO_DESCRIPTION = "발표용 합성 데이터입니다. 실제 DW 실적이나 실제 과거 자동 실행 기록이 아닙니다.";
const sales = [
  [100000000, 102000000, 105000000, 86100000],
  [120000000, 122000000, 125000000, 127500000],
  [90000000, 91000000, 76440000, 79497600],
];
const rounded = (n) => Math.round(n * 100) / 100;
const metric = (value, previous) => ({ value, previous,
  difference: rounded(value - previous), change: previous ? rounded(100 * (value - previous) / previous) : null });
function split(total, weights) {
  const parts = weights.map((w) => Math.round(total * w));
  parts[parts.length - 1] += total - parts.reduce((n, v) => n + v, 0);
  return parts;
}
function channelSales(store, week) {
  if (week === 0) return split(sales[store][week], [.55, .45]);
  const previous = channelSales(store, week - 1);
  const offline = sales[store][week] < sales[store][week - 1]
    ? Math.round(previous[0] * 1.02) : Math.round(sales[store][week] * .55);
  return [offline, sales[store][week] - offline];
}
export function validateDemoScenario(raw, spec, mode) {
  if (raw === undefined) return undefined;
  if (!raw || raw.id !== PRESENTATION_SCENARIO || mode !== "demo" ||
      spec.dimension !== "store" || spec.store || spec.channel)
    bad("발표용 시나리오는 전체 점포의 시연 조사에서만 사용할 수 있습니다.");
  if (typeof raw.anchorEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.anchorEnd) ||
      !Number.isFinite(Date.parse(raw.anchorEnd)) || new Date(raw.anchorEnd).toISOString().slice(0, 10) !== raw.anchorEnd)
    bad("시연 기준일을 확인하세요.");
  return { id: PRESENTATION_SCENARIO, anchorEnd: raw.anchorEnd };
}
export async function scenarioData(spec, demonstration) {
  if (demonstration?.id !== PRESENTATION_SCENARIO || ![0, 1, 2].includes(demonstration.phase))
    bad("시연 시나리오를 확인하세요.");
  const { phase, anchorEnd } = demonstration;
  const end = dateAdd(anchorEnd, (phase - 2) * 7);
  if (spec.end && spec.end !== end) bad("발표용 조사의 기간은 시나리오 주차로 고정됩니다.");
  if (spec.days !== 7 || spec.comparison !== "previous") bad("발표용 조사는 주간 전주 비교만 지원합니다.");
  if (spec.metrics.some((m) => !["sales", "orders", "averageOrder", "activeCustomers"].includes(m)))
    bad("발표용 시나리오는 매출·주문·객단가·고객 집계만 지원합니다.");
  const stores = await all("SELECT id,name FROM stores ORDER BY id");
  if (![1, 2, 3].every((id) => stores.some((s) => Number(s.id) === id))) bad("시연 점포를 확인하세요.");
  const groups = new Map();
  function add(id, label, current, previous) {
    const row = groups.get(id) || { id, label, current: 0, previous: 0 };
    row.current += current; row.previous += previous; groups.set(id, row);
  }
  for (let i = 0; i < 3; i++) {
    const store = stores.find((s) => Number(s.id) === i + 1);
    if (spec.store && spec.store !== String(store.id)) continue;
    let current = sales[i][phase + 1], previous = sales[i][phase];
    const currentChannels = channelSales(i, phase + 1), previousChannels = channelSales(i, phase);
    if (spec.channel) {
      const channel = ["오프라인", "모바일 앱"].indexOf(spec.channel);
      if (channel < 0) bad("시연 채널을 확인하세요.");
      current = currentChannels[channel]; previous = previousChannels[channel];
    }
    if (spec.dimension === "store") add(String(store.id), store.name, current, previous);
    else if (spec.dimension === "channel") {
      ["오프라인", "모바일 앱"].forEach((label, j) => {
        if (!spec.channel || spec.channel === label) add(label, label, currentChannels[j], previousChannels[j]);
      });
    } else {
      const labels = spec.dimension === "category" ? ["패션", "뷰티", "식품"]
        : spec.dimension === "grade" ? ["VIP", "골드", "실버", "일반"]
        : spec.dimension === "day" ? Array.from({ length: 7 }, (_, d) => dateAdd(end, d - 6)) : null;
      if (!labels) bad("시연 분석 축을 확인하세요.");
      const weights = spec.dimension === "category" ? [.45, .3, .25]
        : spec.dimension === "grade" ? [.15, .25, .3, .3] : Array(7).fill(1 / 7);
      const a = split(current, weights), b = split(previous, weights);
      labels.forEach((label, j) => add(label, label, a[j], b[j]));
    }
  }
  return { spec: { ...spec, end }, range: ranges(spec, end), complete: true,
    rows: [...groups.values()].map((r) => {
      const orders = Math.round(r.current / 400000), previousOrders = Math.round(r.previous / 400000);
      const metrics = {
        sales: metric(r.current, r.previous), orders: metric(orders, previousOrders),
        averageOrder: metric(rounded(r.current / orders), rounded(r.previous / previousOrders)),
        activeCustomers: metric(Math.round(orders * .8), Math.round(previousOrders * .8)),
      };
      return { id: r.id, label: r.label, metrics: Object.fromEntries(spec.metrics.map((m) => [m, metrics[m]])) };
    }),
    queriedAt: new Date().toISOString(), notes: [SCENARIO_DESCRIPTION],
    demonstration: { ...demonstration, description: SCENARIO_DESCRIPTION },
  };
}
export async function scenarioReport(app, config, phase = 2) {
  const demonstration = { ...config.demoScenario, phase };
  const data = await scenarioData({ ...app.spec, end: undefined, days: 7, comparison: "previous" }, demonstration);
  const { evaluate } = await import("./metric-agents.mjs");
  const rows = data.rows.map((r) => ({ ...r, matched: evaluate(r.metrics[config.metric], config) }));
  const alertCount = rows.filter((r) => r.matched).length;
  return { ...data, rows, config, status: alertCount ? "alert" : "normal", alertCount,
    appTitle: app.title, appVersion: app.version, investigations: [],
    summary: alertCount ? `${alertCount}개 점포에서 시연 조건을 발견했습니다.` : "시연 조건에 해당하는 점포가 없습니다.",
    steps: ["발표용 합성 데이터의 주차·점포 범위 확인", "동일 시나리오에서 현재·비교 매출 집계", "점포별 감소 조건 평가"],
    ...(phase < 2 ? { replay: { asOf: new Date(dateAdd(data.range.end, 1) + "T09:00:00+09:00").toISOString(), source: "synthetic_scenario", description: SCENARIO_DESCRIPTION } } : {}),
  };
}
export async function seedPresentationTask(agentId) {
  const { getAgent, saveAgent, runAgent, agentRuns } = await import("./metric-agents.mjs");
  const { saveApp } = await import("./app-store.mjs");
  let agent = await getAgent(agentId);
  if (await one("SELECT id FROM metric_agent_runs WHERE agent_id=? AND status='running'", [agentId])) bad("진행 중인 업무가 끝난 뒤 시연을 준비하세요.");
  if (!agent.config.demoScenario) {
    const seed = await one("SELECT * FROM seed_info");
    const dow = new Date(seed.end_date + "T00:00:00Z").getUTCDay();
    const anchorEnd = dateAdd(seed.end_date, -(dow === 0 ? 7 : dow));
    const app = await saveApp({ prompt: "발표용 합성 시나리오", spec: {
      title: "[시연] 점포별 주간 매출 조사", metrics: ["sales", "orders"], dimension: "store",
      days: 7, comparison: "previous", store: "", channel: "", chart: "bar",
    } });
    agent = await saveAgent({ appId: app.id, enabled: false, config: {
      ...agent.config, name: "[시연] 점포별 주간 매출 조사", investigationMode: "demo",
      metric: "sales", condition: "drop", threshold: 10, period: "week",
      demoScenario: { id: PRESENTATION_SCENARIO, anchorEnd },
    } }, agentId);
  }
  const existing = await agentRuns(agentId);
  for (const phase of [0, 1]) {
    const slot = `${PRESENTATION_SCENARIO}:${phase}`;
    if (!existing.some((r) => r.slot === slot))
      await runAgent(agentId, { kind: "replay", demoPhase: phase, slot });
  }
  const runs = (await agentRuns(agentId)).filter((r) => r.report.demonstration);
  return { agentId, name: agent.name, historyCount: runs.filter((r) => r.kind === "replay").length,
    historicalStore: "판교점", currentStore: "더현대 서울", anchorEnd: agent.config.demoScenario.anchorEnd };
}
