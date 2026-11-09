export type Page =
  | "overview"
  | "customers"
  | "sales"
  | "campaigns"
  | "app"
  | "budget"
  | "catalog"
  | "lineage"
  | "settings";
export const pageNames: Record<Page, string> = {
  overview: "통합 현황",
  customers: "고객 분석",
  sales: "매출 분석",
  campaigns: "캠페인 성과",
  app: "앱 이용 현황",
  budget: "예산·실적",
  catalog: "데이터 카탈로그",
  lineage: "데이터 리니지",
  settings: "관리자 설정",
};
export type Filters = { days: string; store: string; channel: string };
export const defaultFilters: Filters = {
  days: "30",
  store: "전체 점포",
  channel: "전체 채널",
};
export function scale(f: Filters) {
  return (
    (Number(f.days) / 30) *
    (f.store === "전체 점포" ? 1 : f.store === "더현대 서울" ? 0.42 : 0.28) *
    (f.channel === "전체 채널" ? 1 : f.channel === "모바일 앱" ? 0.62 : 0.38)
  );
}
export function makeTrend(f: Filters) {
  const s = scale(f);
  return Array.from({ length: Number(f.days) }, (_, i) => ({
    day: `${i + 1}일`,
    current: Math.round(
      ((1700 + i * 73 + Math.sin(i * 1.5) * 250 + Math.cos(i * 0.7) * 180) *
        s *
        30) /
        Number(f.days),
    ),
    previous: Math.round(
      ((1450 + i * 52 + Math.sin(i * 1.3) * 190) * s * 30) / Number(f.days),
    ),
  }));
}
export const campaigns = [
  {
    name: "가을 재방문 쿠폰",
    target: 18420,
    conversion: 8.7,
    progress: 68,
    status: "진행 중",
    channel: "모바일 앱",
  },
  {
    name: "신규 고객 웰컴",
    target: 9104,
    conversion: 6.2,
    progress: 82,
    status: "진행 중",
    channel: "모바일 앱",
  },
  {
    name: "앱 푸시 재구매",
    target: 26811,
    conversion: 4.9,
    progress: 43,
    status: "진행 중",
    channel: "모바일 앱",
  },
  {
    name: "VIP 프라이빗 초대",
    target: 2400,
    conversion: 12.4,
    progress: 100,
    status: "완료",
    channel: "오프라인",
  },
  {
    name: "주말 쇼핑 리워드",
    target: 12400,
    conversion: 5.8,
    progress: 31,
    status: "진행 중",
    channel: "오프라인",
  },
];
export type Asset = {
  id: string;
  name: string;
  type: string;
  engine: string;
  description: string;
  owner: string;
  rows: string;
  columns: string[];
  x: number;
  y: number;
};
export const assets: Asset[] = [
  {
    id: "orders",
    name: "orders",
    type: "SOURCE",
    engine: "POSTGRESQL · OLTP",
    description: "점포·온라인 주문 원천 데이터",
    owner: "커머스플랫폼팀",
    rows: "2,401,883",
    columns: [
      "order_id · PK",
      "customer_id",
      "ordered_at",
      "net_amount",
      "store_id",
    ],
    x: 30,
    y: 105,
  },
  {
    id: "payment_events",
    name: "payment_events",
    type: "SOURCE",
    engine: "KAFKA · STREAM",
    description: "온·오프라인 결제 이벤트 스트림",
    owner: "Data Platform",
    rows: "3,829,106",
    columns: [
      "event_id · PK",
      "order_id",
      "payment_method",
      "amount",
      "created_at",
    ],
    x: 30,
    y: 290,
  },
  {
    id: "load_orders_daily",
    name: "load_orders_daily",
    type: "INGEST",
    engine: "AIRFLOW · INGEST",
    description: "매일 09:00 주문 증분 적재",
    owner: "Data Platform",
    rows: "2,401,883",
    columns: ["execution_date", "order_id", "loaded_at"],
    x: 240,
    y: 105,
  },
  {
    id: "normalize_payment",
    name: "normalize_payment",
    type: "INGEST",
    engine: "SPARK · STREAM",
    description: "실시간 결제 이벤트 정규화",
    owner: "Data Platform",
    rows: "3,829,106",
    columns: ["event_id", "order_id", "normalized_amount"],
    x: 240,
    y: 290,
  },
  {
    id: "dw.fact_orders",
    name: "dw.fact_orders",
    type: "WAREHOUSE",
    engine: "SNOWFLAKE · TABLE",
    description: "주문·결제 통합 팩트 테이블",
    owner: "데이터엔지니어링팀",
    rows: "2,401,883",
    columns: [
      "order_id · PK",
      "customer_id",
      "store_id",
      "net_amount",
      "ordered_at",
    ],
    x: 450,
    y: 200,
  },
  {
    id: "mart.sales_daily",
    name: "mart.sales_daily",
    type: "DATA MART",
    engine: "DBT · MODEL",
    description: "일별·점포별 매출 집계",
    owner: "데이터분석팀",
    rows: "1,824",
    columns: ["sales_date", "store_id", "total_sales", "order_count"],
    x: 660,
    y: 105,
  },
  {
    id: "mart.customer_ltv",
    name: "mart.customer_ltv",
    type: "DATA MART",
    engine: "DBT · MODEL",
    description: "고객 생애가치와 재구매 지표",
    owner: "CRM팀",
    rows: "82,104",
    columns: ["customer_id · PK", "lifetime_value", "purchase_count"],
    x: 660,
    y: 290,
  },
  {
    id: "sales_dashboard",
    name: "일별 매출 현황",
    type: "CONSUMPTION",
    engine: "LOOKER · DASHBOARD",
    description: "점포별 매출 분석 대시보드",
    owner: "데이터분석팀",
    rows: "1,824",
    columns: ["sales_date", "store_name", "total_sales"],
    x: 870,
    y: 105,
  },
  {
    id: "customer_report",
    name: "고객 LTV 리포트",
    type: "CONSUMPTION",
    engine: "POWER BI · REPORT",
    description: "고객 가치 및 세그먼트 리포트",
    owner: "CRM팀",
    rows: "82,104",
    columns: ["customer_id", "segment", "lifetime_value"],
    x: 870,
    y: 290,
  },
];
export const edges = [
  ["orders", "load_orders_daily"],
  ["payment_events", "normalize_payment"],
  ["load_orders_daily", "dw.fact_orders"],
  ["normalize_payment", "dw.fact_orders"],
  ["dw.fact_orders", "mart.sales_daily"],
  ["dw.fact_orders", "mart.customer_ltv"],
  ["mart.sales_daily", "sales_dashboard"],
  ["mart.customer_ltv", "customer_report"],
  ["mart.customer_ltv", "sales_dashboard"],
];
export function related(id: string, direction: "up" | "down"): string[] {
  const visited = new Set<string>();
  function visit(current: string) {
    for (const edge of edges) {
      const [from, to] = direction === "down" ? edge : [edge[1], edge[0]];
      if (from === current && !visited.has(to)) {
        visited.add(to);
        visit(to);
      }
    }
  }
  visit(id);
  return [...visited];
}
