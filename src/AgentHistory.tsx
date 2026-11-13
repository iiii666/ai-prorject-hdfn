import { useEffect, useState } from "react";
import { History, RefreshCw, Play, Bell } from "lucide-react";
import { request } from "./api";
import { Panel, timestamp } from "./components";
import type { Run, Meta } from "./analysis-types";
import AgentRunReport, { runKinds } from "./AgentRunReport";
import "./agent-history.css";
type HistoryRun=Run & {agent_id:string;agent_name:string;app_id:string};
type Result={items:HistoryRun[];total:number;page:number;pageSize:number;totalPages:number;counts:Record<string,number>;queriedAt:string};
type Agent={id:string;name:string};
const statuses:Record<string,string>={alert:"조건 발견",normal:"정상",no_data:"판단 보류",error:"실행 실패",running:"실행 중"};
const emptyFilters={agent:"",status:"",kind:"",from:"",to:""};
export default function AgentHistory({meta,agents,onRefresh,onOpenApp,onOpenAgent,onInvestigate}:{meta:Meta;agents:Agent[];onRefresh:()=>Promise<void>;onOpenApp:(id:string)=>void;onOpenAgent:(id:string)=>void;onInvestigate?:(id:string)=>void}){
  const [filters,setFilters]=useState(emptyFilters),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[seeding,setSeeding]=useState(false);
  const query=new URLSearchParams({...filters,page:String(page),pageSize:"5"}).toString();
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");
    request<Result>("/api/metric-agents/history?"+query,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted){setResult(r);setLoading(false);}}).catch(e=>{if(!controller.signal.aborted){setError(e.message);setLoading(false);}});
    return()=>controller.abort();
  },[query,revision]);
  useEffect(()=>{const timer=setInterval(()=>setRevision(r=>r+1),15000);return()=>clearInterval(timer);},[]);
  function change(key:string,value:string){setFilters(f=>({...f,[key]:value}));setPage(1);}
  async function prepare(){
    setSeeding(true);setError("");setNotice("");
    try{
      const out=await request<{agentId:string;count:number;message:string}>("/api/metric-agents/demo",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      await onRefresh();setFilters({...emptyFilters,agent:out.agentId,kind:"replay"});setPage(1);setRevision(r=>r+1);setNotice(out.message+" 총 "+out.count+"건입니다.");
    }catch(e){setError((e as Error).message);}finally{setSeeding(false);}
  }
  return <div className="agent-history">
    <Panel title="전체 활동 기록" aside={<History size={19}/>}>
      <div className="history-demo"><div><strong>월요일 오전 9시 · 지난주 매출 10% 감소 점검</strong><p>최근 8주를 DB에서 다시 조회한 이력과 데이터 부족 사례 1건을 준비합니다. 실제 과거 정기 실행과 구분되는 과거 분석 기록이며, 자동 감시는 비활성 상태로 생성됩니다.</p></div>
      <button className="primary" disabled={seeding} onClick={()=>void prepare()}><Play size={15}/>{seeding?"과거 기간 조회 중…":"과거 분석 이력 준비 / 불러오기"}</button></div>
      {notice&&<p className="app-success" role="status">{notice}</p>}
      {error&&<p className="analysis-error" role="alert">{error}</p>}
      <fieldset className="history-filters" disabled={seeding}>
        <label className="app-field">감시 에이전트<select aria-label="이력 감시 에이전트" value={filters.agent} onChange={e=>change("agent",e.target.value)}><option value="">전체 에이전트</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="app-field">상태<select aria-label="이력 상태" value={filters.status} onChange={e=>change("status",e.target.value)}><option value="">전체 상태</option>{Object.entries(statuses).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label className="app-field">실행 유형<select aria-label="이력 실행 유형" value={filters.kind} onChange={e=>change("kind",e.target.value)}><option value="">전체 유형</option>{Object.entries(runKinds).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        <label className="app-field">기록 시작일 (한국 시간)<input aria-label="이력 기록 시작일" type="date" value={filters.from} onChange={e=>change("from",e.target.value)}/></label>
        <label className="app-field">기록 종료일 (한국 시간)<input aria-label="이력 기록 종료일" type="date" value={filters.to} onChange={e=>change("to",e.target.value)}/></label>
      </fieldset>
      <div className="app-actions"><button disabled={seeding} onClick={()=>setRevision(r=>r+1)}><RefreshCw size={15}/>이력 다시 조회</button><button onClick={()=>{setFilters(emptyFilters);setPage(1);}}>필터 초기화</button></div>
      <p className="app-definition">날짜 필터는 이력을 저장한 시각 기준입니다. 과거 분석 기록의 과거 재현 기준일과 분석 주차는 보고서에서 확인하세요. 15초마다 최신 상태를 조회합니다.</p>
    </Panel>
    {result&&<div className="history-stats" aria-label="이력 집계"><div><span>조회 이력</span><strong>{result.total}건</strong></div>{["alert","normal","no_data","error"].map(s=><div key={s} className={s}><span>{statuses[s]}</span><strong>{result.counts[s]||0}건</strong></div>)}</div>}
    <Panel title="실행 보고서 목록" aside={<span className="muted">{result?timestamp(result.queriedAt):""}</span>}>
      {loading?<p className="muted" role="status">이력을 조회하고 있습니다…</p>:result?.items.length?result.items.map(r=><div key={r.id} className="history-record" data-testid="history-record">
        <AgentRunReport run={r} meta={meta} agentName={r.agent_name} onOpenApp={()=>onOpenApp(r.app_id)} onInvestigate={onInvestigate}/>
        <button className="history-agent-link" onClick={()=>onOpenAgent(r.agent_id)}><Bell size={14}/>업무 열기</button>
      </div>):<div className="app-preview-empty"><History size={30}/><h3>조회된 실행 이력이 없습니다</h3><p>과거 분석 이력을 준비하거나 필터를 바꿔보세요. 감시 에이전트를 시험 실행해도 이력이 쌓입니다.</p></div>}
      <div className="history-pagination"><button disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>이전 페이지</button><span aria-live="polite">{page} / {Math.max(1,result?.totalPages||1)} 페이지</span><button disabled={loading||!result||page>=result.totalPages} onClick={()=>setPage(p=>p+1)}>다음 페이지</button></div>
    </Panel>
  </div>;
}
