import type { ReactNode } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Analytics } from "./api";
export const num = (v: number) => v.toLocaleString("ko-KR");
export const money = (v: number) =>
  `₩ ${Math.round(v).toLocaleString("ko-KR")}`;
export const compactMoney = (v: number) =>
  Math.abs(v) >= 1e8
    ? `₩ ${(v / 1e8).toFixed(2)}억`
    : Math.abs(v) >= 1e4
      ? `₩ ${(v / 1e4).toFixed(1)}만`
      : money(v);
export const pct = (v: number | null) =>
  v === null ? "—" : `${v.toFixed(1)}%`;
export const timestamp = (v: string) =>
  new Date(v).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Kpi({
  label,
  value,
  note,
  change,
  unit = "%",
  warning = false,
}: {
  label: string;
  value: string;
  note?: string;
  change?: number | null;
  unit?: string;
  warning?: boolean;
}) {
  return (
    <article className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" title={value}>
        {value}
      </div>
      <div className={`kpi-change ${warning ? "danger" : ""}`}>
        {change !== undefined
          ? change === null
            ? "비교 기준 없음"
            : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}${unit} 전기 대비`
          : note}
      </div>
    </article>
  );
}
export function Progress({
  value,
  warm = false,
}: {
  value: number | null;
  warm?: boolean;
}) {
  return (
    <div className={`progress ${warm ? "warm" : ""}`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value || 0))}%` }} />
    </div>
  );
}
export function DataTable({
  headers,
  rows,
  empty = "조회 결과가 없습니다.",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <div className="empty">{empty}</div>}
    </div>
  );
}
export function Trend({
  data,
  app = false,
}: {
  data: Analytics;
  app?: boolean;
}) {
  return (
    <>
      <div className="legend">
        <span>
          <i />
          {app ? "활성 사용자" : "매출"}
        </span>
        {!app && (
          <span>
            <i />
            직전 동일 길이 기간
          </span>
        )}
      </div>
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          {app ? (
            <BarChart data={data.app.daily}>
              <CartesianGrid vertical={false} stroke="#edf0f6" />
              <XAxis
                dataKey="date"
                minTickGap={40}
                tickFormatter={(v) => v.slice(5)}
                tickLine={false}
              />
              <YAxis width={45} tickLine={false} />
              <Tooltip
                formatter={(v) => [`${num(Number(v))}명`, "활성 사용자"]}
              />
              <Bar
                dataKey="users"
                fill="#5585f6"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          ) : (
            <AreaChart
              data={data.sales.trend}
              margin={{ left: 4, right: 18, top: 10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4d7ff6" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#4d7ff6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#edf0f6" />
              <XAxis
                dataKey="date"
                minTickGap={40}
                tickFormatter={(v) => v.slice(5)}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={60}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${Math.round(v / 1e4)}만`}
              />
              <Tooltip
                formatter={(v, n) => [
                  money(Number(v)),
                  n === "sales" ? "매출" : "전기 매출",
                ]}
              />
              <Area
                type="monotone"
                dataKey="previous"
                stroke="#a5baff"
                strokeDasharray="5 5"
                fill="none"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="#4f80ff"
                strokeWidth={2.5}
                fill="url(#salesFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </>
  );
}
export function BudgetSummary({ data }: { data: Analytics }) {
  return (
    <div className="budget-summary">
      <div className="budget-label">
        <span>예산 집행 {pct(data.budget.execution)}</span>
        <strong>
          {compactMoney(data.budget.spent)} /{" "}
          {compactMoney(data.budget.planned)}
        </strong>
      </div>
      <Progress value={data.budget.execution} />
      <div className="budget-label">
        <span>매출 목표 달성 {pct(data.budget.achievement)}</span>
        <strong>
          {compactMoney(data.summary.sales)} /{" "}
          {compactMoney(data.budget.salesTarget)}
        </strong>
      </div>
      <Progress value={data.budget.achievement} warm />
      <div className="mini-stats">
        <div>
          <span>선택 기간 앱 활성 사용자</span>
          <strong>
            {num(data.app.users)}
            <small>명</small>
          </strong>
        </div>
        <div>
          <span>DB 조회 시각 (KST)</span>
          <strong className="status">
            {new Date(data.queriedAt).toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour12: false,
            })}
          </strong>
        </div>
      </div>
    </div>
  );
}
