import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Panel, DataTable, timestamp } from "./components";
import type { Data, Meta } from "./analysis-types";
const fmt = (n: number | null | undefined, unit = "") =>
  n == null
    ? "—"
    : `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
export default function AnalysisPreview({
  data,
  meta,
}: {
  data: Data;
  meta: Meta;
}) {
  return (
    <div className="app-preview">
      <div className="app-preview-heading">
        <div>
          <span className="app-eyebrow">{data.demonstration ? "PRESENTATION SCENARIO" : "LIVE ANALYSIS"}</span>
          <h2>{data.spec.title}</h2>
          <p>
            {data.range.start} ~ {data.range.end} · 비교{" "}
            {data.range.previousStart} ~ {data.range.previousEnd}
          </p>
        </div>
        <span className="app-chip">{data.demonstration ? "시연 합성 집계" : "서버 집계"}</span>
      </div>
      {data.demonstration && <p className="app-warning">{data.demonstration.description}</p>}
      {!data.complete && (
        <p className="app-warning">
          데이터 보유 범위가 부족합니다. 미보유 기간의 0은 실제 실적이 아닐 수
          있습니다.
        </p>
      )}
      {!data.rows.length ? (
        <p className="empty">조건에 맞는 데이터가 없습니다.</p>
      ) : (
        data.spec.metrics.map((m) => {
          const metric = meta.metrics[m];
          const chart = data.rows.map((r) => ({
            name: r.label,
            current: r.metrics[m].value,
            previous: r.metrics[m].previous,
          }));
          const best = data.rows
            .filter((r) => r.metrics[m].value !== null)
            .sort(
              (a, b) => (b.metrics[m].value || 0) - (a.metrics[m].value || 0),
            )[0];
          return (
            <Panel
              key={m}
              title={metric.label}
              aside={
                <span className="muted">
                  {metric.unit} · {meta.dimensions[data.spec.dimension]}
                </span>
              }
            >
              <p className="app-metric-note">
                {best
                  ? `최댓값: ${best.label} ${fmt(best.metrics[m].value, metric.unit)}`
                  : "계산 가능한 값이 없습니다."}
              </p>
              {data.spec.chart !== "table" && (
                <div className="app-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    {data.spec.chart === "line" ? (
                      <LineChart data={chart}>
                        <CartesianGrid vertical={false} stroke="#edf0f6" />
                        <XAxis dataKey="name" />
                        <YAxis
                          width={70}
                          tickFormatter={(n) =>
                            Intl.NumberFormat("ko-KR", {
                              notation: "compact",
                            }).format(n)
                          }
                        />
                        <Tooltip
                          formatter={(v) => fmt(Number(v), metric.unit)}
                        />
                        <Line
                          name="현재"
                          dataKey="current"
                          stroke="#4f80ff"
                          dot={false}
                        />
                        <Line
                          name="비교"
                          dataKey="previous"
                          stroke="#a5b4cd"
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      </LineChart>
                    ) : (
                      <BarChart data={chart}>
                        <CartesianGrid vertical={false} stroke="#edf0f6" />
                        <XAxis dataKey="name" />
                        <YAxis
                          width={70}
                          tickFormatter={(n) =>
                            Intl.NumberFormat("ko-KR", {
                              notation: "compact",
                            }).format(n)
                          }
                        />
                        <Tooltip
                          formatter={(v) => fmt(Number(v), metric.unit)}
                        />
                        <Bar
                          name="현재"
                          dataKey="current"
                          fill="#4f80ff"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          name="비교"
                          dataKey="previous"
                          fill="#cbd5e1"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
              <DataTable
                headers={["구분", "현재", "비교", "증감률", "차이"]}
                rows={data.rows.map((r) => [
                  r.label,
                  fmt(r.metrics[m].value, metric.unit),
                  fmt(r.metrics[m].previous, metric.unit),
                  fmt(r.metrics[m].change, "%"),
                  fmt(
                    r.metrics[m].difference,
                    metric.unit === "%" ? "%p" : metric.unit,
                  ),
                ])}
              />
              <p className="app-definition">
                {metric.definition} · 출처 {data.demonstration ? "발표용 합성 시나리오" : metric.source}
              </p>
            </Panel>
          );
        })
      )}
      <details className="app-details">
        <summary>지표 해석과 데이터 근거</summary>
        <ul>
          {data.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        <p>조회 시각: {timestamp(data.queriedAt)}</p>
      </details>
    </div>
  );
}
