import { useEffect, useRef, useState } from "react";
import { Bot, ChevronRight, Plus, RefreshCw, Settings2 } from "lucide-react";
import { request } from "./api";
import type { Agent, Config, Meta, Run } from "./analysis-types";
import { Panel, timestamp } from "./components";
import AgentRunReport, { runKinds } from "./AgentRunReport";
import AgentHistory from "./AgentHistory";
import TaskFindings, { investigationModes } from "./TaskFindings";
const objective = "변화가 큰 그룹을 조사하고 확인된 사실과 추가 확인할 가설을 구분해줘.";
const runStatus: Record<string, string> = { running: "실행 중", alert: "발견사항 있음", normal: "정상", no_data: "데이터 확인 필요", error: "실행 실패" };
export default function AssignedTasks({ meta, selectedId, onInvestigate, onNew, onOpenApp }: {
  meta: Meta; selectedId: string; onInvestigate: (id: string) => void;
  onNew: () => void; onOpenApp: (id: string) => void;
}) {
  const [items, setItems] = useState<Agent[]>([]), [selected, setSelected] = useState<Agent | null>(null),
    [runs, setRuns] = useState<Run[]>([]), [error, setError] = useState(""),
    [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const selection = useRef("");
  const first = useRef(true);
  async function refresh() {
    const agents = await request<Agent[]>("/api/metric-agents");
    setItems(agents);
    return agents;
  }
  async function open(agent: Agent) {
    selection.current = agent.id;
    setSelected({ ...agent, config: { ...agent.config } });
    setRuns([]);
    setNotice("");
    const next = await request<Run[]>(`/api/metric-agents/${agent.id}/runs`);
    if (selection.current === agent.id) setRuns(next);
  }
  useEffect(() => {
    let active = true;
    refresh().then(async (agents) => {
      if (!active) return;
      const initial = agents.find((a) => a.id === selectedId) || (first.current ? agents[0] : null);
      first.current = false;
      if (initial) await open(initial);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [selectedId]);
  useEffect(() => {
    if (!selected || busy) return;
    let active = true;
    const id = selected.id;
    const timer = setInterval(() => {
      Promise.all([request<Run[]>(`/api/metric-agents/${id}/runs`), request<Agent[]>("/api/metric-agents")])
        .then(([next, agents]) => { if (active && selection.current === id) { setRuns(next); setItems(agents); } })
        .catch((e) => { if (active) setError(e.message); });
    }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [selected?.id, busy]);
  async function act(fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function edit(patch: Partial<Config>) {
    if (selected) setSelected({ ...selected, config: { ...selected.config, ...patch } });
  }
  const latest = runs[0];
  const findings = latest?.report.findings;
  return <div className="assigned-tasks">
    <div className="task-page-heading"><div><h3>맡긴 업무</h3><p>반복해서 살펴볼 일을 맡기고, 발견부터 후속 조사까지 한곳에서 확인하세요.</p></div>
      <button className="primary" onClick={onNew}><Plus size={16}/>새 업무 맡기기</button></div>
    {error && <p className="analysis-error" role="alert">{error}</p>}
    {notice && <p className="app-success" role="status">{notice}</p>}
    <div className="task-layout">
      <aside className="task-list" aria-label="맡긴 업무 목록">
        {items.map((a) => <button key={a.id} disabled={busy} aria-pressed={selected?.id === a.id} onClick={() => void act(() => open(a))}>
          <div><span className={`task-dot ${a.enabled ? "enabled" : ""}`}/><small>{a.enabled ? "진행 중" : "일시 중지"}</small><ChevronRight size={15}/></div>
          <strong>{a.name}</strong><p>{a.config.objective || objective}</p>
          <span className="app-chip">{investigationModes[a.config.investigationMode || "off"]}</span>
          <small>{a.latestRun ? runStatus[a.latestRun.status] : "아직 실행하지 않았습니다"}</small>
          <small>{a.enabled ? `다음 ${timestamp(a.next_run)}` : "준비되면 업무를 시작하세요"}</small>
        </button>)}
        {!items.length && <div className="task-empty"><Bot size={30}/><h4>아직 맡긴 업무가 없습니다</h4><p>AI에게 조사한 뒤 “이 결과를 저장하고 매주 확인해줘”라고 요청하세요.</p><button onClick={onNew}>첫 업무 맡기기</button></div>}
      </aside>
      {selected ? <main className="task-detail" aria-label="업무 상세">
        <Panel title={selected.name} aside={<span className="app-chip">{selected.enabled ? "진행 중" : "일시 중지"}</span>}>
          <p className="task-objective">{selected.config.objective || objective}</p>
          <p className="muted">{selected.config.frequency === "daily" ? "매일" : `매주 ${["일", "월", "화", "수", "목", "금", "토"][selected.config.weekday]}요일`} {selected.config.time} · 한국 시간 · {investigationModes[selected.config.investigationMode || "off"]}</p>
          <div className="invest-actions">
            <button disabled={busy || latest?.status === "running"} className="primary" onClick={() => void act(async () => {
              const original = items.find((a) => a.id === selected.id);
              if (JSON.stringify(original?.config) !== JSON.stringify(selected.config) || original?.enabled !== selected.enabled)
                throw Error("변경한 업무 설정을 먼저 저장하세요.");
              setNotice("업무를 실행하고 있습니다. 자동 조사는 잠시 걸릴 수 있습니다.");
              await request(`/api/metric-agents/${selected.id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
              const agents = await refresh();
              await open(agents.find((a) => a.id === selected.id)!);
              setNotice("지금 확인을 완료했습니다. 시험 실행은 정기 실행의 발견 기록과 별도로 추적합니다.");
            })}>{busy ? "처리 중…" : "지금 확인하기"}</button>
            <button disabled={busy} onClick={() => void act(async () => {
              const original = items.find((a) => a.id === selected.id)!;
              if (JSON.stringify(original.config) !== JSON.stringify(selected.config) || original.enabled !== selected.enabled)
                throw Error("변경한 업무 설정을 먼저 저장하세요.");
              const saved = await request<Agent>(`/api/metric-agents/${selected.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: original.app_id, config: original.config, enabled: !original.enabled }) });
              await refresh(); await open(saved); setNotice(saved.enabled ? "업무를 시작했습니다." : "업무를 일시 중지했습니다.");
            })}>{items.find((a) => a.id === selected.id)?.enabled ? "업무 일시 중지" : "업무 시작"}</button>
            <button onClick={() => onOpenApp(selected.app_id)}>연결된 분석 보기</button>
            <button disabled={busy} aria-label="업무 새로고침" onClick={() => void act(async () => { const agents = await refresh(); await open(agents.find((a) => a.id === selected.id)!); })}><RefreshCw size={14}/></button>
          </div>
          <p className="app-definition">자동 실행은 서버가 켜져 있을 때 동작합니다. 데이터가 부족하면 회복으로 판단하지 않습니다.</p>
        </Panel>
        <Panel title="최근 발견사항" aside={<small className="muted">{latest ? `${runKinds[latest.kind] || latest.kind} · ${timestamp(latest.created_at)}` : "첫 실행 대기"}</small>}>
          {findings?.length ? <TaskFindings findings={findings} meta={meta} metric={latest.report.config?.metric || selected.config.metric} onInvestigate={onInvestigate}/>
            : <div className="task-empty"><Bot size={27}/><h4>{latest?.status === "running" ? "업무를 수행하고 있습니다" : latest?.status === "normal" ? "발견 조건에 해당하는 변화가 없습니다" : latest?.status === "no_data" ? "판단할 데이터가 부족합니다" : latest?.status === "error" ? "업무를 완료하지 못했습니다" : "확인할 준비가 됐습니다"}</h4><p>{latest?.report.summary || "지금 확인하기를 누르거나 예정된 실행을 기다려주세요."}</p></div>}
          {latest && !findings && <AgentRunReport run={latest} meta={meta} onInvestigate={onInvestigate}/>}
        </Panel>
        <details className="task-section"><summary><Settings2 size={16}/>업무 설정</summary>
          <fieldset disabled={busy} className="invest-form">
            <label>업무 이름<input maxLength={80} value={selected.config.name} onChange={(e) => edit({ name: e.target.value })}/></label>
            <label>조사 방식<select aria-label="조사 방식" value={selected.config.investigationMode || "off"} onChange={(e) => edit({ investigationMode: e.target.value as Config["investigationMode"] })}>
              <option value="live" disabled={!meta.aiConfigured}>실제 AI 조사{!meta.aiConfigured ? " · API 키 필요" : ""}</option><option value="demo">시연 · 규칙 기반 조사</option><option value="off">규칙 점검</option>
            </select></label>
            <label className="task-wide">맡길 업무<textarea maxLength={1000} minLength={3} value={selected.config.objective || objective} onChange={(e) => edit({ objective: e.target.value })}/></label>
            <label>실행 주기<select aria-label="실행 주기" value={selected.config.frequency} onChange={(e) => edit({ frequency: e.target.value })}><option value="weekly">매주</option><option value="daily">매일</option></select></label>
            <label>요일<select aria-label="요일" disabled={selected.config.frequency === "daily"} value={selected.config.weekday} onChange={(e) => edit({ weekday: Number(e.target.value) })}>{["일", "월", "화", "수", "목", "금", "토"].map((d, i) => <option key={d} value={i}>{d}요일</option>)}</select></label>
            <label>한국 시간<input type="time" value={selected.config.time} onChange={(e) => edit({ time: e.target.value })}/></label>
            <label>분석 기간<select aria-label="분석 기간" value={selected.config.period} onChange={(e) => edit({ period: e.target.value })}><option value="week">직전 완료 주 vs 그 이전 주</option><option value="rolling">어제 종료 · 분석 기간 비교</option></select></label>
            <label>확인 지표<input readOnly value={meta.metrics[selected.config.metric]?.label || selected.config.metric}/></label>
            <label>조사 시작 조건<select aria-label="조사 시작 조건" value={selected.config.condition} onChange={(e) => edit({ condition: e.target.value })}><option value="drop">상대 감소율 이상 (%)</option><option value="below">지표 값 미만</option><option value="above">지표 값 초과</option></select></label>
            <label>기준값<input type="number" min={0} value={selected.config.threshold} onChange={(e) => edit({ threshold: Number(e.target.value) })}/></label>
            <label className="invest-check"><input type="checkbox" checked={selected.enabled} onChange={(e) => setSelected({ ...selected, enabled: e.target.checked })}/>업무 활성화</label>
            <p className="task-wide app-definition">발견한 그룹 중 지표 변화가 큰 최대 3개를 조사합니다. 실제 AI 조사는 집계 근거를 OpenAI로 전송합니다. 시연 모드는 모델을 호출하지 않습니다. 기준을 바꾸면 발견 추적을 새로 시작합니다.</p>
            <div className="invest-actions"><button className="primary" onClick={() => void act(async () => {
              const saved = await request<Agent>(`/api/metric-agents/${selected.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appId: selected.app_id, config: selected.config, enabled: selected.enabled }) });
              await refresh(); await open(saved); setNotice("업무 설정을 저장했습니다.");
            })}>업무 설정 저장</button></div>
          </fieldset>
        </details>
        <details className="task-section"><summary>활동 기록 · {runs.length}건</summary>
          <p className="muted">정상 결과도 기록합니다. 시험·정기·과거 재현 기록은 구분해서 표시합니다. 최근 50건을 확인할 수 있습니다.</p>
          {runs.map((r) => <AgentRunReport key={r.id} run={r} meta={meta} onInvestigate={onInvestigate}/>)}
          {!runs.length && <p className="muted">아직 실행 기록이 없습니다.</p>}
        </details>
      </main> : items.length > 0 ? <p className="empty">확인할 업무를 선택하세요.</p> : null}
    </div>
    <details className="task-section" onToggle={(e) => setShowHistory(e.currentTarget.open)}>
      <summary>전체 활동 기록 찾아보기</summary>
      {showHistory && <AgentHistory meta={meta} agents={items}
        onRefresh={async () => { await refresh(); }} onOpenApp={onOpenApp}
        onInvestigate={onInvestigate}
        onOpenAgent={(id) => void act(async () => { const agents = await refresh(); const agent = agents.find((a) => a.id === id); if (agent) await open(agent); })}/>}
    </details>
  </div>;
}
