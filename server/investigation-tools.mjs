import { all, one, dateAdd } from "./db.mjs";
import { appData } from "./app-data.mjs";
import {
  bad,
  METRICS,
  DIMENSIONS,
  validateSpec,
  validateStore,
} from "./app-plans.mjs";
export const TOOL_DEFINITIONS = {
  inspect_catalog: "지원 지표·분석 축·점포·샘플 데이터 보유 기간 확인",
  compare_sales:
    "매출·주문 수·객단가·활성 고객의 현재/비교 집계를 점포·채널·상품군·일별로 조회",
  compare_customer_grades:
    "고객 등급별 매출·주문 수·객단가·고객 수를 집계. 개인 행은 조회하지 않음",
  compare_app_conversion: "앱 구매 전환율을 점포·채널·일별로 비교",
  compare_budget: "예산 집행률과 매출 목표 달성률을 점포·채널·일별로 비교",
};
export async function toolCatalog() {
  return {
    tools: TOOL_DEFINITIONS,
    metrics: METRICS,
    dimensions: DIMENSIONS,
    stores: await all("SELECT id,name FROM stores"),
    seed: await one("SELECT * FROM seed_info"),
  };
}
export async function defaultScope() {
  const seed = await one("SELECT * FROM seed_info");
  const dow = new Date(seed.end_date + "T00:00:00Z").getUTCDay();
  return {
    days: 7,
    end: dateAdd(seed.end_date, -(dow === 0 ? 7 : dow)),
    store: "",
    channel: "",
    comparison: "previous",
  };
}
export async function validateScope(raw) {
  const spec = await validateStore(
    validateSpec({
      ...raw,
      title: "조사 범위",
      metrics: ["sales"],
      dimension: "store",
      chart: "table",
    }),
  );
  const seed = await one("SELECT * FROM seed_info");
  if (!spec.end || spec.end > seed.end_date)
    bad("조사 종료일은 DB 최신 데이터일 이하여야 합니다.");
  return {
    days: spec.days,
    end: spec.end,
    store: spec.store,
    channel: spec.channel,
    comparison: spec.comparison,
  };
}
export async function executeTool(name, scope, dimension, filters = {}) {
  if (!Object.hasOwn(TOOL_DEFINITIONS, name))
    bad("허용되지 않은 조사 도구입니다.");
  if (name === "inspect_catalog") return toolCatalog();
  if ((filters.gradeFilter || filters.categoryFilter) &&
      ["compare_app_conversion", "compare_budget"].includes(name))
    bad("이 도구는 지정된 고객 등급·상품군 범위의 집계를 지원하지 않습니다.");
  const d = name === "compare_customer_grades" ? "grade" : dimension;
  if (!["store", "channel", "category", "day", "grade"].includes(d))
    bad("분석 축을 확인하세요.");
  const metrics =
    name === "compare_app_conversion"
      ? ["appConversion"]
      : name === "compare_budget"
        ? ["budgetExecution", "achievement"]
        : d === "category"
          ? ["sales", "orders", "averageOrder"]
          : ["sales", "orders", "averageOrder", "activeCustomers"];
  const result = await appData(
    {
      ...scope,
      title:
        DIMENSIONS[d] +
        " " +
        (name === "compare_app_conversion"
          ? "앱 전환율 변화"
          : name === "compare_budget"
            ? "예산·목표 비교"
            : "매출·주문 변화"),
      metrics,
      dimension: d,
      chart: d === "day" ? "line" : "bar",
    },
    { strictCoverage: true, ...filters },
  );
  return { ...result, queriedAt: result.queriedAt || new Date().toISOString() };
}
export function scopeKey(scope) {
  return JSON.stringify([
    scope.end,
    scope.days,
    scope.store,
    scope.channel,
    scope.comparison,
  ]);
}
export function verifiedFindings(steps) {
  return steps
    .flatMap((s) =>
      (s.result?.rows || []).slice(0, 12).map((r) => ({
        evidenceId: s.id,
        tool: s.tool,
        group: r.label,
        metrics: r.metrics,
      })),
    )
    .slice(-36);
}
