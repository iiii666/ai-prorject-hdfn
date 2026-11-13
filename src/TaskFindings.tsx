import { ArrowUpRight, Search, CheckCircle2, CircleAlert } from "lucide-react";
import type { Finding, Meta } from "./analysis-types";
import { timestamp } from "./components";
export const findingStates = { new: "새로 발견", ongoing: "지속 중", recovered: "회복", deferred: "판단 보류" };
export const investigationModes = { live: "실제 AI 조사", demo: "시연 · 규칙 기반 조사", off: "규칙 점검" };
const resultStates: Record<string, string> = {
  completed: "조사 완료", running: "조사 중", error: "조사 실패", unavailable: "AI 설정 필요",
  paused: "이어서 조사 필요", clarification: "추가 확인 필요", limited: "조사 한도", off: "규칙 점검",
};
const value = (v: number | null | undefined, unit: string) => v == null ? "—" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
export default function TaskFindings({ findings, meta, metric, onInvestigate }: {
  findings: Finding[]; meta: Meta; metric: string; onInvestigate?: (id: string) => void;
}) {
  const definition = meta.metrics[metric];
  return <div className="task-findings">{findings.map((f) => <article key={f.key} className={`task-finding ${f.state}`}>
    <div className="task-finding-heading">
      {f.state === "recovered" ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>}
      <h4>{f.group}</h4><span className="app-chip">{findingStates[f.state]}</span>
    </div>
    <div className="task-numbers">
      <div><span>{definition?.label || metric}</span><strong>{value(f.metric?.value, definition?.unit || "")}</strong></div>
      <div><span>비교 기간 대비</span><strong>{value(f.metric?.change, "%")}</strong></div>
    </div>
    <p className="muted">최초 발견 {timestamp(f.firstSeen)}{f.previousRunId ? " · 이전 실행과 비교" : " · 첫 관찰"}</p>
    {f.state === "recovered" && <p>같은 기준으로 다시 확인한 결과, 발견 조건을 벗어났습니다.</p>}
    {f.state === "deferred" && <p>현재 데이터만으로 지속·회복을 판단할 수 없습니다.</p>}
    {f.investigation && <div className="task-investigation">
      <small><Search size={13}/> {investigationModes[f.investigation.mode]} · {resultStates[f.investigation.status] || f.investigation.status}</small>
      {f.investigation.summary && <p>{f.investigation.summary}</p>}
      {f.investigation.queryCount !== undefined && <small>조회 도구 실행 {f.investigation.queryCount}회 · 해석과 가설은 조회 근거로 확인하세요.</small>}
      {f.investigation.sessionId && onInvestigate && <button onClick={() => onInvestigate(f.investigation!.sessionId!)}>
        근거 확인·후속 질문 <ArrowUpRight size={14}/>
      </button>}
    </div>}
  </article>)}</div>;
}
