import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronRight, Download, FileText, MessageCircle, Send } from "lucide-react";
import type { Agent, Meta, Run } from "./analysis-types";
import type { Session } from "./investigation-types";
import type { TaskReport, WorkflowView } from "./task-workflow-types";
import { request } from "./api";
import { DataTable, timestamp } from "./components";
import AnalysisPreview from "./AnalysisPreview";
import "./task-workflow.css";
const titles = ["상황 보고", "업무 상황 확인", "함께 조사하기", "다음 행동", "보고서 PDF"];
const actions: Record<string, { label: string; prompt?: string; decision?: string }> = {
  compare_channels: { label: "어느 채널에서 줄었나요?", prompt: "채널별로 나누어 감소가 집중된 곳을 확인하고 다음 확인할 내용을 알려줘." },
  compare_categories: { label: "어떤 상품이 달라졌나요?", prompt: "상품군별 매출 변화를 비교하고 감소가 집중된 상품군을 조사해줘." },
  compare_grades: { label: "어떤 고객층이 달라졌나요?", prompt: "고객 등급별 매출과 주문 변화를 조사해줘." },
  compare_history: { label: "지난번 문제와 비교해줘", prompt: "저장된 이전 실행 이력과 이번 결과를 비교하고 지난번 발견한 점포의 경과도 정리해줘." },
  follow_up: { label: "다음에 회복 여부 확인", decision: "follow_up" },
  contact: { label: "담당자 확인 내용 정리", decision: "contact" },
};
const decisionLabels: Record<string, string> = { investigate: "조사를 더 이어갈게요", follow_up: "다음 실행에서 회복을 확인할게요", contact: "담당자에게 확인할 내용을 정리할게요" };
const judgmentLabels: Record<string, string> = { unreviewed: "미판단", expected: "예상된 변화예요", important: "중요하게 봐주세요", resolved: "업무상 해결됐어요" };
const fmt = (n: number | null | undefined, unit = "") => n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) + unit;
const post = <T,>(url: string, body: unknown) => request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export default function TaskWorkflow({ agent, run, meta }: { agent: Agent; run: Run; meta: Meta }) {
  const [groupKey, setGroupKey] = useState(run.report.findings?.find((f) => f.state !== "recovered")?.key || ""),
    [mode, setMode] = useState<"live" | "demo">(meta.aiConfigured ? "live" : "demo"),
    [stage, setStage] = useState(1), [view, setView] = useState<WorkflowView | null>(null),
    [error, setError] = useState(""), [busy, setBusy] = useState(false), [stepping, setStepping] = useState(false),
    [auto, setAuto] = useState(true), [prompt, setPrompt] = useState(""), [businessNote, setBusinessNote] = useState(""),
    [judgment, setJudgment] = useState("important"), [decision, setDecision] = useState("follow_up"),
    [decisionNote, setDecisionNote] = useState(""), [report, setReport] = useState<TaskReport | null>(null);
  const current = useRef<WorkflowView | null>(null), generation = useRef(0), requesting = useRef(false), hydrated = useRef(false);
  const prefix = `/api/metric-agents/${agent.id}`;
  const query = new URLSearchParams({ run: run.id, group: groupKey, mode }).toString();
  const selection = { runId: run.id, groupKey, mode };
  function accept(next: WorkflowView) { current.current = next; setView(next); }
  async function refresh() { const next = await request<WorkflowView>(`${prefix}/review?${query}`); accept(next); return next; }
  useEffect(() => {
    const controller = new AbortController(); const gen = ++generation.current;
    setView(null); current.current = null; setError(""); setReport(null);
    request<WorkflowView>(`${prefix}/review?${query}`, { signal: controller.signal }).then((next) => {
      if (gen !== generation.current) return;
      accept(next); setBusinessNote(next.review.state.context?.note || "");
      setJudgment(next.review.state.judgment === "unreviewed" ? "important" : next.review.state.judgment);
      setDecision(next.review.state.decision?.kind || "follow_up"); setDecisionNote(next.review.state.decision?.note || "");
      if (!hydrated.current) {
        const state = next.review.state;
        setStage(!state.acknowledged ? 1 : !state.context ? 2 : next.session?.status !== "completed" ? 3 : !state.decision ? 4 : 5);
        hydrated.current = true;
      }
      setAuto(true);
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [prefix, query]);
  const session = view?.session, round = session?.state.rounds.at(-1);
  useEffect(() => {
    if (stage !== 3 || !auto || !session || round?.status !== "running" || requesting.current) return;
    const id = session.id, version = session.version, gen = generation.current;
    const timer = setTimeout(() => {
      requesting.current = true; setStepping(true);
      post<Session>(`/api/investigations/${id}/step`, { version }).then((s) => {
        if (gen !== generation.current || current.current?.session?.id !== id) return;
        if (current.current.session.version > s.version) return;
        accept({ ...current.current, session: s });
      }).catch(async (e) => {
        if (gen !== generation.current) return;
        try { const s = await request<Session>(`/api/investigations/${id}`); if (current.current?.session?.id === id) accept({ ...current.current, session: s }); } catch { /* Retain the actionable error. */ }
        if (!/이전 조회|상태가 바뀌/.test(e.message)) { setError(e.message); setAuto(false); }
      }).finally(() => { requesting.current = false; setStepping(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [session, round?.status, stage, auto, stepping]);
  async function save(body: Record<string, unknown>, nextStage?: number) {
    if (!current.current) return;
    setBusy(true); setError("");
    try {
      accept(await post<WorkflowView>(`${prefix}/review`, { ...selection, version: current.current.review.version, ...body }));
      setReport(null); if (nextStage) setStage(nextStage); return true;
    } catch (e) { setError((e as Error).message); await refresh().catch(() => {}); return false; }
    finally { setBusy(false); }
  }
  async function send(value = prompt) {
    if (!current.current || busy || value.trim().length < 3) return;
    setBusy(true); setError(""); const gen = generation.current;
    try {
      const old = current.current;
      const next = await post<WorkflowView>(`${prefix}/conversation`, { ...selection,
        version: old.review.version, sessionId: old.session?.id, sessionVersion: old.session?.version, prompt: value });
      if (gen !== generation.current) return;
      accept(next); setPrompt(""); setAuto(true); setReport(null);
    } catch (e) { if (gen === generation.current) { setError((e as Error).message); await refresh().catch(() => {}); } }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (stage !== 5 || !view) return;
    const controller = new AbortController(); setReport(null);
    request<TaskReport>(`${prefix}/report?${query}`, { signal: controller.signal }).then(setReport)
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [stage, view?.review.version, view?.session?.version, prefix, query]);
  async function download() {
    if (!report?.ready) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${prefix}/report-pdf`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, version: report.reviewVersion, sessionVersion: report.sessionVersion }) });
      if (!response.ok) throw Error((await response.json()).error || "보고서를 저장하지 못했습니다.");
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `업무분석보고서-${run.report.range?.end || "결과"}.pdf`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const state = view?.review.state;
  const analysisDone = round?.status === "completed" && !!round.report && session?.state.task?.businessContext?.note === state?.context?.note;
  const gates = [true, !!state?.acknowledged, !!state?.context, !!analysisDone, !!state?.decision && !!analysisDone];
  const metricId = run.report.config?.metric || agent.config.metric;
  const row = run.report.rows?.find((r) => r.id === groupKey);
  const metric = row?.metrics[metricId];
  const allSteps = session?.state.rounds.flatMap((r) => r.steps) || [];
  function chooseAction(key: string) {
    const action = actions[key]; if (!action) return;
    if (action.prompt) void send(action.prompt);
    else if (action.decision) { setDecision(action.decision); setStage(4); }
  }
  return <section className="task-workflow" aria-label="업무 검토와 보고서">
    <div className="review-heading"><div><span>YOUR WORK PARTNER</span><h3>발견부터 보고까지, 함께 정리해요</h3><p>업무 상황을 알려주시면 필요한 내용을 더 확인하고 다음 일을 정리합니다.</p></div><Bot size={29}/></div>
    <div className="review-context-bar"><label>함께 볼 대상<select aria-label="검토 대상" disabled={busy || stepping} value={groupKey} onChange={(e) => { hydrated.current = false; setGroupKey(e.target.value); }}><option value="">전체 업무</option>{run.report.rows?.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label><small>{run.report.range?.start} ~ {run.report.range?.end}</small></div>
    <nav className="review-progress" aria-label="업무 진행 단계">{titles.map((title, i) => <button key={title} disabled={!gates[i] || busy || stepping} aria-current={stage === i + 1 ? "step" : undefined} onClick={() => setStage(i + 1)}><span>{gates[i + 1] || (i === 4 && state?.lastExport) ? <Check size={14}/> : i + 1}</span>{title}</button>)}</nav>
    {error && <p className="analysis-error" role="alert">{error}</p>}
    {!view ? <p role="status" className="muted">업무 맥락을 불러오고 있습니다…</p> : <div className="review-stage" aria-label={titles[stage - 1]}>
      {stage === 1 && <>
        <span className="review-kicker">01 / 상황 보고</span><h4>{row ? `${row.label}의 변화를 확인했어요` : "이번 실행 결과를 확인해 주세요"}</h4>
        <p>{run.report.summary}</p>
        {row && <div className="review-metrics"><div><small>{meta.metrics[metricId]?.label}</small><strong>{fmt(metric?.value, meta.metrics[metricId]?.unit)}</strong></div><div><small>비교 기간 대비</small><strong>{fmt(metric?.change, "%")}</strong></div></div>}
        {!!view.history.length && <div className="review-note"><strong>지난번에는요</strong>{view.history.map((h) => <p key={h.runId}>{h.range.start} ~ {h.range.end} · {h.summary}</p>)}</div>}
        {!!view.memory.length && <div className="review-note"><strong>기억하고 있는 업무 맥락</strong>{view.memory.map((m) => <p key={m.runId}>{m.context?.note || "업무 상황 미입력"} · {judgmentLabels[m.judgment] || m.judgment}</p>)}</div>}
        <button className="primary review-next" disabled={busy} onClick={() => void save({ action: "acknowledge" }, 2)}>확인했어요, 다음으로<ChevronRight size={16}/></button>
      </>}
      {stage === 2 && <>
        <span className="review-kicker">02 / 업무 상황 확인</span><h4>최근 행사나 매장 운영에 변화가 있었나요?</h4><p>현장에서 알고 계신 내용을 알려주세요. 조사할 가설로 참고하고, 조회로 확인한 사실과 구분해서 정리합니다.</p>
        <div className="review-choices">{["최근 행사가 끝났어요", "운영에 변화가 있었어요", "아직 원인을 모르겠어요", "특이사항은 없어요"].map((v) => <button key={v} onClick={() => setBusinessNote(v)}>{v}</button>)}</div>
        <label className="review-field">알고 계신 업무 상황<textarea aria-label="업무 상황" maxLength={1600} value={businessNote} onChange={(e) => setBusinessNote(e.target.value)} placeholder="예: 지난주 모바일 할인 행사가 끝났어요."/></label>
        <small className="muted">저장한 상황과 판단은 이 업무의 다음 조사에도 참고합니다.</small>
        <button className="primary review-next" disabled={busy || !businessNote.trim()} onClick={() => void save({ action: "context", note: businessNote }, 3)}>상황을 저장하고 함께 조사하기<ChevronRight size={16}/></button>
      </>}
      {stage === 3 && <>
        <div className="review-chat-heading"><div><span className="review-kicker">03 / 함께 조사하기</span><h4>무엇부터 더 확인해볼까요?</h4></div><select aria-label="업무 대화 방식" disabled={busy || stepping} value={mode} onChange={(e) => setMode(e.target.value as "live" | "demo")}><option value="live" disabled={!meta.aiConfigured}>AI와 대화{!meta.aiConfigured ? " · 설정 필요" : ""}</option><option value="demo">규칙 기반 조사</option></select></div>
        <p className="review-mode-note">{mode === "live" ? "질문·업무 상황·집계 근거를 OpenAI에 전달해 AI가 다음 조회나 확인 질문을 선택합니다." : "정해진 규칙으로 요청한 관점의 데이터를 확인합니다."}</p>
        {session?.status === "completed" && !analysisDone && <p className="review-note">업무 상황이 바뀌었습니다. 새 상황을 반영할 수 있도록 질문을 보내주세요.</p>}
        {!session && <div className="review-agent-intro"><Bot size={24}/><p>{view.group}의 결과와 “{state?.context?.note}”라는 상황을 함께 살펴볼게요. 채널과 상품 중 어느 쪽부터 확인할까요?</p></div>}
        <div className="review-messages" aria-live="polite">{session?.state.messages.map((m) => <article className={m.role} key={m.id}><strong>{m.role === "user" ? "나" : mode === "live" ? "업무 에이전트" : "조사 결과"}</strong><p>{m.text}</p></article>)}</div>
        {(stepping || round?.status === "running") && <p className="invest-working" role="status">조회 결과를 살펴보고 다음 확인할 내용을 정리하고 있습니다…</p>}
        {round?.error && <p className="analysis-error">{round.error}</p>}
        {round?.report?.followUpQuestion && <div className="review-note"><strong>다음으로 궁금한 점</strong><p>{round.report.followUpQuestion}</p></div>}
        <div className="review-choices">{(round?.report?.suggestedActions?.length ? round.report.suggestedActions : ["compare_channels", "compare_categories", "compare_history"]).filter((key) => actions[key]).map((key) => <button disabled={busy} key={key} onClick={() => chooseAction(key)}>{actions[key].label}</button>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="review-compose"><label className="review-field">추가 질문이나 답변<textarea aria-label="업무 에이전트에게 답변" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1000} minLength={3} required placeholder="모바일 쪽만 더 봐줘. 행사 종료 영향도 확인해줄래?"/></label><button className="primary" disabled={busy || prompt.trim().length < 3}><Send size={15}/>{busy ? "전달 중…" : "보내기"}</button></form>
        <div className="review-inline-actions">{!auto && session?.status === "running" && <button onClick={() => { setError(""); setAuto(true); }}>조사 이어가기</button>}{session && ["error", "paused"].includes(session.status) && <button onClick={async () => { try { const s = await post<Session>(`/api/investigations/${session.id}/pause`, { version: session.version, resume: true }); accept({ ...view, session: s }); setAuto(true); setError(""); } catch (e) { setError((e as Error).message); } }}>조사 다시 이어가기</button>}</div>
        {!!allSteps.length && <details className="review-evidence"><summary>어떻게 확인했나요? · 근거 {allSteps.length}개</summary>{allSteps.map((step, i) => <details key={step.id}><summary>근거 {i + 1} · {step.reason}</summary>{step.result.history ? step.result.history.map((h) => <div key={h.runId}><p>{h.range.start} ~ {h.range.end} · {h.summary}</p><DataTable headers={["점포", "현재 매출", "증감률"]} rows={h.rows.map((r) => [r.label, fmt(r.metrics.sales?.value, "원"), fmt(r.metrics.sales?.change, "%")])}/></div>) : <AnalysisPreview data={step.result} meta={meta}/>}</details>)}</details>}
        <button className="primary review-next" disabled={busy || stepping || !analysisDone} onClick={() => setStage(4)}>조사 내용을 확인하고 다음 행동 정하기<ChevronRight size={16}/></button>
      </>}
      {stage === 4 && <>
        <span className="review-kicker">04 / 다음 행동</span><h4>이 결과를 어떻게 이어갈까요?</h4>
        <label className="review-field">현업의 판단<select aria-label="업무 판단" value={judgment} onChange={(e) => setJudgment(e.target.value)}>{["expected", "important", "resolved"].map((key) => <option key={key} value={key}>{judgmentLabels[key]}</option>)}</select></label>
        <div className="review-decision-options">{Object.entries(decisionLabels).map(([key, label]) => <label key={key}><input type="radio" name={`decision-${agent.id}`} checked={decision === key} onChange={() => setDecision(key)}/><span>{label}</span></label>)}</div>
        {decision === "contact" && <div className="review-note"><strong>담당자에게 확인할 질문</strong><p>행사·상품 구성·운영 시간에 변화가 있었나요?<br/>감소한 채널이나 고객군에 별도 이슈가 있었나요?<br/>다음 확인 때까지 어떤 조치를 누가 진행하나요?</p></div>}
        {decision === "follow_up" && <p className="review-note">다음 실행에서 같은 기준으로 경과를 확인할 계획을 기록합니다. 현재 업무 일정은 그대로 사용합니다.</p>}
        <label className="review-field">추가로 남길 내용<textarea aria-label="다음 행동 메모" value={decisionNote} maxLength={1000} onChange={(e) => setDecisionNote(e.target.value)} placeholder="담당자 확인 내용이나 다음에 중요하게 볼 점을 적어주세요."/></label>
        <small className="muted">‘해결됐어요’는 사용자의 업무 판단으로 저장합니다. 실제 지표 회복은 별도로 확인합니다.</small>
        <button className="primary review-next" disabled={busy} onClick={async () => {
          if (await save({ action: "judgment", judgment, note: "" })) await save({ action: "decision", kind: decision, note: decisionNote }, 5);
        }}>판단과 다음 행동 저장하기<ChevronRight size={16}/></button>
      </>}
      {stage === 5 && <>
        <span className="review-kicker">05 / 보고서 PDF</span><h4>확인한 내용을 보고자료로 정리했어요</h4><p>수치와 근거, 조사 해석, 사용자 의견과 다음 행동을 구분해 담습니다.</p>
        {!report ? <p role="status">보고서 미리보기를 정리하고 있습니다…</p> : <>
          <article className="review-report-preview"><div><FileText size={23}/><h4>{report.title}</h4></div><p>{report.group} · {report.range.start} ~ {report.range.end}</p>
            <h5>상황 보고</h5><p>{report.summary}</p><DataTable headers={["대상", report.metricLabel, "비교 기간", "증감률"]} rows={report.rows.map((r) => [r.label, fmt(r.metrics[report.metric]?.value, report.unit), fmt(r.metrics[report.metric]?.previous, report.unit), fmt(r.metrics[report.metric]?.change, "%")])}/>
            <h5>알려주신 업무 상황</h5><p>{report.businessContext}</p><h5>{report.mode === "live" ? "AI 조사 해석 · 확인이 필요한 가설" : "조사 해석"}</h5><p>{report.analysis}</p><h5>사용자 판단과 다음 행동</h5><p>{report.judgment} · {report.decision}</p>{report.decisionNote && <p>{report.decisionNote}</p>}
            <small>PDF에는 이전 실행 비교, 조회 근거 {report.evidence.length}개와 주요 대화도 함께 포함합니다.</small>
          </article>
          <button className="primary review-next" disabled={busy || !report.ready} onClick={() => void download()}><Download size={17}/>{busy ? "PDF 만드는 중…" : "보고서 PDF 다운로드"}</button>
          {!report.ready && <p className="muted">이전 단계에서 상황 확인·조사 완료·다음 행동 저장을 마쳐주세요.</p>}
          {state?.lastExport && <p className="review-success" role="status">보고서를 만들었습니다 · {timestamp(state.lastExport.at)}</p>}
        </>}
      </>}
    </div>}
    <div className="review-footer"><MessageCircle size={14}/>대화와 판단은 이 업무의 실행 결과에 연결해 저장합니다.</div>
  </section>;
}
