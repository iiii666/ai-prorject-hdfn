import type { Run, Meta } from "./MyAnalysisApps";
import { DataTable, timestamp } from "./components";
const fmt = (n: number | null | undefined, unit = "") =>
  n == null
    ? "—"
    : `${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
const statuses: Record<string, string> = {
  running: "실행 중",
  alert: "조건 발견",
  normal: "정상",
  no_data: "판단 보류",
  error: "실행 실패",
};

export const runKinds: Record<string,string>={test:"시험 실행",scheduled:"정기 실행",replay:"시연 · 과거 재현"};
export default function AgentRunReport({run:r,meta,open=false,onOpenApp,agentName}:{run:Run;meta:Meta;open?:boolean;onOpenApp?:()=>void;agentName?:string}){
return (<details
                      className={`app-run ${r.status}`}
                      key={r.id}
                      open={open}
                    >
                      <summary>
                        <span className="app-chip">
                          {statuses[r.status] || r.status}
                        </span>{" "}
                        {runKinds[r.kind] || r.kind} ·{" "}
                        {timestamp(r.created_at)}
                        <strong>{r.report.summary || "분석 중…"}</strong>
                      </summary>
                      {agentName && <p className="app-history-agent">{agentName}</p>}
                      {r.report.replay && <p className="app-warning"><strong>시연 · 과거 재현</strong><br/>재현 기준: {timestamp(r.report.replay.asOf)}<br/>{r.report.replay.description}</p>}
                      {r.report.appTitle && (
                        <p>
                          {r.report.appTitle} · 실행 시점 v{r.report.appVersion}
                        </p>
                      )}
                      {r.report.range && (
                        <p className="muted">
                          분석: {r.report.range.start} ~ {r.report.range.end}
                          <br />
                          비교: {r.report.range.previousStart} ~{" "}
                          {r.report.range.previousEnd}
                        </p>
                      )}
                      {r.report.config && (
                        <p>
                          판단 기준:{" "}
                          {meta.metrics[r.report.config.metric].label} ·{" "}
                          {r.report.config.condition === "drop"
                            ? "상대 감소율 이상"
                            : r.report.config.condition === "below"
                              ? "값 미만"
                              : "값 초과"}{" "}
                          ·{" "}
                          {fmt(
                            r.report.config.threshold,
                            r.report.config.condition === "drop"
                              ? "%"
                              : meta.metrics[r.report.config.metric].unit,
                          )}
                        </p>
                      )}
                      {r.report.rows && r.report.config && (
                        <DataTable
                          headers={["그룹", "현재", "비교", "증감률", "판정"]}
                          rows={r.report.rows.map((row) => {
                            const metric = row.metrics[r.report.config!.metric];
                            return [
                              row.label,
                              fmt(metric.value),
                              fmt(metric.previous),
                              fmt(metric.change, "%"),
                              row.matched === null
                                ? "보류"
                                : row.matched
                                  ? "조건 발견"
                                  : "정상",
                            ];
                          })}
                        />
                      )}
                      {r.report.investigations?.map((v, j) => (
                        <div key={j}>
                          <h4>{v.group} 추가 조회</h4>
                          {v.details.map((d) => (
                            <div key={d.dimension}>
                              <p>{meta.dimensions[d.dimension]} 증감액</p>
                              <DataTable
                                headers={[
                                  "구분",
                                  "현재 매출",
                                  "비교 매출",
                                  "증감액",
                                ]}
                                rows={d.rows.map((row) => [
                                  row.label,
                                  fmt(row.value, "원"),
                                  fmt(row.previous, "원"),
                                  fmt(row.difference, "원"),
                                ])}
                              />
                            </div>
                          ))}
                        </div>
                      ))}
                      <details className="app-details">
                        <summary>수행 단계와 해석 근거</summary>
                        <ol>
                          {r.report.steps?.map((s, j) => (
                            <li key={j}>{s}</li>
                          ))}
                        </ol>
                        <ul>
                          {r.report.notes?.map((n, j) => (
                            <li key={j}>{n}</li>
                          ))}
                        </ul>
                      </details>
                      {onOpenApp && <button onClick={onOpenApp}>연결된 분석 앱 열기</button>}
                    </details>);
}
