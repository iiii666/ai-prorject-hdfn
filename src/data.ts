export type Page =
  | "overview"
  | "customers"
  | "sales"
  | "campaigns"
  | "app"
  | "budget"
  | "catalog"
  | "lineage"
  | "settings"
  | "custom";
export const pageNames: Record<Page, string> = {
  overview: "통합 현황",
  customers: "고객 분석",
  sales: "매출 분석",
  campaigns: "캠페인 성과",
  app: "앱 이용 현황",
  budget: "예산·실적",
  custom: "커스텀 분석",
  catalog: "데이터 카탈로그",
  lineage: "데이터 리니지",
  settings: "관리자 설정",
};
export type Filters = {
  start: string;
  end: string;
  store: string;
  channel: string;
};
export function related(
  id: string,
  direction: "up" | "down",
  edges: { source: string; target: string }[],
): string[] {
  const visited = new Set<string>();
  function visit(current: string) {
    for (const e of edges) {
      const from = direction === "down" ? e.source : e.target,
        to = direction === "down" ? e.target : e.source;
      if (from === current && to !== id && !visited.has(to)) {
        visited.add(to);
        visit(to);
      }
    }
  }
  visit(id);
  return [...visited];
}
export const dateAdd = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
