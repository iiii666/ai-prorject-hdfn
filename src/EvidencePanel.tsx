import {
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Panel, DataTable, money, pct, num } from "./components";
export type Breakdown = {
  byStore: {
    storeId: number;
    storeName: string;
    sales: number;
    orders: number;
    customers: number;
    share: number | null;
    averageOrder: number;
    rank: number;
    previousSales: number;
    change: number | null;
  }[];
  byChannel: {
    channel: string;
    sales: number;
    orders: number;
    customers: number;
    share: number | null;
  }[];
  byCategory: {
    category: string;
    sales: number;
    quantity: number;
    share: number | null;
  }[];
  byGrade: {
    grade: string;
    sales: number;
    orders: number;
    customers: number;
    share: number | null;
  }[];
  monthlyByStore: {
    month: string;
    storeId: number;
    storeName: string;
    sales: number;
  }[];
  budgetByStore: {
    storeName: string;
    planned: number;
    spent: number;
    salesTarget: number;
  }[];
  byDepartment: {
    department: string;
    planned: number;
    spent: number;
    salesTarget: number;
  }[];
  appByStore: {
    storeName: string;
    sessions: number;
    users: number;
    purchases: number;
    averageDuration: number;
  }[];
  sources: {
    actual: { start: string; end: string; definition: string };
    previous: { start: string; end: string };
    budget: { start: string; end: string };
  };
  campaigns: {
    id: number;
    name: string;
    channel: string;
    target: number;
    converted: number;
    conversion: number | null;
    revenue: number;
    planned: number;
    spent: number;
    revenuePerSpend: number | null;
  }[];
};
const colors = ["#4f80ff", "#27b59c", "#b095ef"];
export default function EvidencePanel({
  data,
  months,
}: {
  data: Breakdown;
  months: { actualMonth: string; coveredDays: number }[];
}) {
  const top = data.byStore[0];
  const trend = months.map((m) => {
    const row: Record<string, string | number | null> = {
      month: m.actualMonth,
    };
    for (const store of data.byStore)
      row[String(store.storeId)] = m.coveredDays
        ? data.monthlyByStore.find(
            (r) => r.storeId === store.storeId && r.month === m.actualMonth,
          )?.sales || 0
        : null;
    return row;
  });
  return (
    <div className="evidence-panel">
      <Panel
        title="DB에서 직접 확인한 결과"
        aside={<span className="purple-tag">LLM 생성 수치 아님</span>}
      >
        <div className="definition-note">
          {top ? (
            <>
              조회 범위에서 매출 1위는 <strong>{top.storeName}</strong>입니다.
              보유 실적 {money(top.sales)}, 비중 {pct(top.share)}, 완료 주문{" "}
              {num(top.orders)}건입니다.
            </>
          ) : (
            "선택 조건에 완료 주문이 없습니다."
          )}
        </div>
        <p className="source-caption">
          실적 범위 {data.sources.actual.start} ~ {data.sources.actual.end} ·{" "}
          {data.sources.actual.definition}
        </p>
        <DataTable
          headers={[
            "순위",
            "점포",
            "보유 실적",
            "비중",
            "주문",
            "구매 고객",
            "평균 주문액",
            "전년 동일 기간",
            "증감",
          ]}
          rows={data.byStore.map((s) => [
            s.rank,
            s.storeName,
            money(s.sales),
            pct(s.share),
            num(s.orders),
            num(s.customers),
            money(s.averageOrder),
            money(s.previousSales),
            pct(s.change),
          ])}
        />
        <p className="source-caption">
          전년 비교 범위 {data.sources.previous.start} ~{" "}
          {data.sources.previous.end} · 같은 조회 조건 기준
        </p>
      </Panel>
      <Panel
        title="점포별 월 매출 비교"
        aside={<span className="muted">보유 결제 실적 · 원</span>}
      >
        <div className="forecast-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trend}
              margin={{ left: 15, right: 15, top: 15, bottom: 5 }}
            >
              <CartesianGrid vertical={false} stroke="#edf0f6" />
              <XAxis dataKey="month" tickFormatter={(v) => v.slice(5) + "월"} />
              <YAxis
                width={65}
                tickFormatter={(v) => (v / 1e8).toFixed(1) + "억"}
              />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Legend />
              {data.byStore.map((s, i) => (
                <Line
                  key={s.storeId}
                  dataKey={String(s.storeId)}
                  name={s.storeName}
                  stroke={colors[i % colors.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <div className="customer-grid">
        <Panel title="상품군별 매출">
          <div className="category-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byCategory}>
                <CartesianGrid vertical={false} stroke="#edf0f6" />
                <XAxis dataKey="category" />
                <YAxis
                  width={65}
                  tickFormatter={(v) => (v / 1e8).toFixed(1) + "억"}
                />
                <Tooltip formatter={(v) => money(Number(v))} />
                <Bar
                  dataKey="sales"
                  name="보유 실적"
                  fill="#4f80ff"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <DataTable
            headers={["상품군", "매출", "비중", "수량"]}
            rows={data.byCategory.map((r) => [
              r.category,
              money(r.sales),
              pct(r.share),
              num(r.quantity),
            ])}
          />
        </Panel>
        <Panel title="채널별 매출">
          <DataTable
            headers={["채널", "매출", "비중", "주문"]}
            rows={data.byChannel.map((r) => [
              r.channel,
              money(r.sales),
              pct(r.share),
              num(r.orders),
            ])}
          />
          <h3 className="evidence-subtitle">고객 등급별 매출</h3>
          <DataTable
            headers={["등급", "고객 수", "매출", "비중"]}
            rows={data.byGrade.map((r) => [
              r.grade,
              num(r.customers),
              money(r.sales),
              pct(r.share),
            ])}
          />
        </Panel>
      </div>
      <Panel title="캠페인 성과 근거">
        <DataTable
          headers={[
            "캠페인",
            "채널",
            "대상 / 구매",
            "전환율",
            "기여 매출",
            "집행액",
            "매출 / 집행액",
          ]}
          rows={data.campaigns.map((c) => [
            c.name,
            c.channel,
            `${num(c.target)} / ${num(c.converted)}`,
            pct(c.conversion),
            money(c.revenue),
            money(c.spent),
            c.revenuePerSpend === null ? "—" : `${c.revenuePerSpend}배`,
          ])}
        />
        <p className="source-caption">
          기여 매출/집행액과 전환율은 관측 지표입니다. 캠페인으로 인한 추가 매출
          또는 인과 효과를 뜻하지 않습니다.
        </p>
      </Panel>
      <details className="evidence-details">
        <summary>점포·부문별 예산과 앱 이용 근거 보기</summary>
        <Panel title="점포별 목표와 예산">
          <p className="source-caption">
            실적과 같은 기간: {data.sources.budget.start} ~{" "}
            {data.sources.budget.end}
          </p>
          <DataTable
            headers={["점포", "매출 목표", "배정 예산", "집행액"]}
            rows={data.budgetByStore.map((b) => [
              b.storeName,
              money(b.salesTarget),
              money(b.planned),
              money(b.spent),
            ])}
          />
        </Panel>
        <Panel title="부문별 예산">
          <DataTable
            headers={["부문", "매출 목표", "배정 예산", "집행액"]}
            rows={data.byDepartment.map((b) => [
              b.department,
              money(b.salesTarget),
              money(b.planned),
              money(b.spent),
            ])}
          />
        </Panel>
        <Panel title="점포별 앱 이용">
          <DataTable
            headers={["점포", "이용자", "세션", "구매 세션", "평균 이용 시간"]}
            rows={data.appByStore.map((a) => [
              a.storeName,
              num(a.users),
              num(a.sessions),
              num(a.purchases),
              `${a.averageDuration}초`,
            ])}
          />
        </Panel>
      </details>
    </div>
  );
}
