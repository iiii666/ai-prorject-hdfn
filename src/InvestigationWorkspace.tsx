import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Plus,
  Pause,
  Play,
  Search,
  CheckCircle2,
  Bookmark,
  Bell,
} from "lucide-react";
import { request, type Bootstrap } from "./api";
import type { Meta } from "./analysis-types";
import type {
  Session,
  SessionList,
  Scope,
  Proposal,
} from "./investigation-types";
import { SavedAnalyses } from "./SavedInvestigationOutputs";
import AssignedTasks from "./AssignedTasks";
import AnalysisPreview from "./AnalysisPreview";
import { Panel, timestamp } from "./components";
import "./my-apps.css";
import "./investigation.css";
const post = <T,>(url: string, data: unknown) =>
  request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
const statusNames: Record<string, string> = {
  running: "조사 중",
  paused: "일시 중지",
  completed: "조사 완료",
  clarification: "추가 확인 필요",
  error: "중단 · 확인 필요",
  interrupted: "후속 요청으로 전환",
};
const tools: Record<string, string> = {
  inspect_catalog: "데이터 카탈로그 확인",
  compare_sales: "매출·주문 비교",
  compare_customer_grades: "고객 등급 비교",
  compare_app_conversion: "앱 전환율 비교",
  compare_budget: "예산·목표 비교",
};
type Tab = "chat" | "tasks";
export default function InvestigationWorkspace({
  bootstrap,
}: {
  bootstrap: Bootstrap;
}) {
  const [tab, setTab] = useState<Tab>("chat"),
    [meta, setMeta] = useState<Meta | null>(null),
    [configured, setConfigured] = useState(false),
    [showSaved, setShowSaved] = useState(false);
  const [sessions, setSessions] = useState<SessionList[]>([]),
    [session, setSession] = useState<Session | null>(null),
    [prompt, setPrompt] = useState(
      "지난주 매출이 감소한 점포를 조사하고 추가로 확인할 내용을 정리해줘.",
    ),
    [mode, setMode] = useState<"live" | "demo">("live");
  const [sending, setSending] = useState(false),
    [stepping, setStepping] = useState(false),
    [auto, setAuto] = useState(true),
    [error, setError] = useState(""),
    [selectedEvidence, setSelectedEvidence] = useState(""),
    [selectedOutput, setSelectedOutput] = useState(""),
    [selectedAgent, setSelectedAgent] = useState("");
  const scopeDirty = useRef(false);
  const latest = useRef<Session | null>(null),
    requesting = useRef(false),
    generation = useRef(0);
  const [scope, setScope] = useState<Scope>({
      days: 7,
      end: bootstrap.seed.end_date,
      store: "",
      channel: "",
      comparison: "previous",
    }),
    [customScope, setCustomScope] = useState(false);
  const [draft, setDraft] = useState<Proposal | null>(null),
    [draftEnabled, setDraftEnabled] = useState(false);
  function accept(s: Session) {
    if (latest.current?.id === s.id && latest.current.version > s.version)
      return;
    latest.current = s;
    setSession(s);
    setMode(s.state.mode);
    if (!scopeDirty.current) setScope(s.state.rounds.at(-1)!.scope);
  }
  async function refresh() {
    const [m, l] = await Promise.all([
      request<Meta>("/api/my-apps/meta"),
      request<SessionList[]>("/api/investigations"),
    ]);
    setMeta(m);
    setSessions(l);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    request<{ configured: boolean }>("/api/investigations/meta")
      .then((m) => {
        setConfigured(m.configured);
        if (!m.configured) setMode("demo");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const r = session?.state.rounds.at(-1);
    if (
      tab !== "chat" ||
      !auto ||
      !session ||
      r?.status !== "running" ||
      requesting.current
    )
      return;
    const id = session.id,
      version = session.version,
      currentGeneration = generation.current;
    const timer = setTimeout(() => {
      requesting.current = true;
      setStepping(true);
      post<Session>("/api/investigations/" + id + "/step", { version })
        .then((s) => {
          if (
            generation.current === currentGeneration &&
            latest.current?.id === id
          ) {
            accept(s);
            if (s.status !== "running")
              void refresh().catch((e) => setError(e.message));
          }
        })
        .catch(async (e) => {
          if (
            generation.current !== currentGeneration ||
            latest.current?.id !== id
          )
            return;
          try {
            const s = await request<Session>("/api/investigations/" + id);
            accept(s);
            if (!/이전 조회|상태가 바뀌/.test(e.message)) {
              setAuto(false);
              setError(e.message);
            }
          } catch (err) {
            setAuto(false);
            setError((err as Error).message);
          }
        })
        .finally(() => {
          requesting.current = false;
          setStepping(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [session, auto, tab, stepping]);
  async function open(id: string) {
    setError("");
    setAuto(false);
    generation.current++;
    accept(await request<Session>("/api/investigations/" + id));
    setSelectedEvidence("");
    setDraft(null);
    setTab("chat");
  }
  async function send(text = prompt) {
    if (sending) return;
    setSending(true);
    setError("");
    setDraft(null);
    setSelectedEvidence("");
    try {
      const current = latest.current;
      const s = await post<Session>(
        current
          ? "/api/investigations/" + current.id + "/messages"
          : "/api/investigations",
        {
          prompt: text,
          mode,
          version: current?.version,
          ...(customScope ? { scope } : {}),
        },
      );
      accept(s);
      setAuto(true);
      scopeDirty.current = false;
      setCustomScope(false);
      setPrompt("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (latest.current) {
        try {
          accept(
            await request<Session>("/api/investigations/" + latest.current.id),
          );
        } catch {
          /* keep visible error */
        }
      }
    } finally {
      setSending(false);
    }
  }
  async function pause(resume = false) {
    if (!session) return;
    setError("");
    try {
      accept(
        await post("/api/investigations/" + session.id + "/pause", {
          version: session.version,
          resume,
        }),
      );
      setAuto(resume);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const round = session?.state.rounds.at(-1),
    steps = session?.state.rounds.flatMap((r) => r.steps) || [],
    evidence =
      steps.find((s) => s.id === selectedEvidence) ||
      [...(round?.steps || [])]
        .reverse()
        .find((s) => s.tool !== "inspect_catalog");
  if (!meta)
    return (
      <p className="empty">{error || "조사 에이전트를 준비하고 있습니다…"}</p>
    );
  return (
    <div className="investigation-workspace">
      <div className="invest-intro">
        <div>
          <span>RETAIL INVESTIGATION AGENT</span>
          <h2>궁금한 건 물어보고, 반복할 일은 맡기세요</h2>
          <p>
            AI가 근거를 찾아 조사하고, 맡긴 업무의 변화와 회복 여부를 이어서 확인합니다.
          </p>
        </div>
        <Bot size={38} />
      </div>
      <div
        className="invest-tabs"
        role="tablist"
        aria-label="조사 에이전트 기능"
      >
        {(
          [
            ["chat", "AI에게 조사하기", Search],
            ["tasks", "맡긴 업무", Bell],
          ] as const
        ).map(([id, title, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              void refresh().catch((e) => setError(e.message));
            }}
          >
            <Icon size={16} />
            {title}
          </button>
        ))}
      </div>
      {error && (
        <p className="analysis-error" role="alert">
          {error}
        </p>
      )}
      {tab === "tasks" ? (
        <AssignedTasks meta={meta} selectedId={selectedAgent}
          onInvestigate={(id) => void open(id).catch((e) => setError(e.message))}
          onOpenApp={(id) => { setSelectedOutput(id); setShowSaved(true); setTab("chat"); }}
          onNew={() => {
            generation.current++; latest.current = null; setSession(null);
            setDraft(null); setSelectedEvidence(""); setAuto(true); setCustomScope(false);
            scopeDirty.current = false; setMode(configured ? "live" : "demo");
            setPrompt("매주 점포별 매출 변화를 조사하고, 감소한 곳은 추가로 살펴봐줘. 이 결과를 저장하고 매주 확인해줘.");
            setShowSaved(false); setTab("chat");
          }}/>
      ) : (
        <>
          <div className="invest-secondary-actions"><button aria-expanded={showSaved} onClick={() => setShowSaved(!showSaved)}><Bookmark size={15}/>{showSaved ? "보관함 닫기" : "저장한 분석 보관함"}</button></div>
          {showSaved && <SavedAnalyses meta={meta} selectedId={selectedOutput}/>}
          {session?.state.task && <div className="task-conversation-context">
            <strong>{session.state.task.group} · 맡긴 업무의 후속 조사</strong>
            <p>{session.state.task.objective}</p>
            {(session.state.task.filters.gradeFilter || session.state.task.filters.categoryFilter) && <small>모든 조회는 {session.state.task.filters.gradeFilter || session.state.task.filters.categoryFilter} 그룹에 한정됩니다.</small>}
            <button onClick={() => { setSelectedAgent(session.state.task!.agentId); setTab("tasks"); }}>업무로 돌아가기</button>
          </div>}
          <div className="invest-mode">
            <label>
              새 조사 모드
              <select
                aria-label="조사 모드"
                value={mode}
                onChange={(e) => setMode(e.target.value as "live" | "demo")}
                disabled={!!session}
              >
                <option value="live" disabled={!configured}>
                  실제 AI 도구 선택
                </option>
                <option value="demo">샘플 시연 · 규칙 기반 도구 선택</option>
              </select>
            </label>
            <p>
              {session?.state.mode === "demo" || (!session && mode === "demo")
                ? "시연은 실제 DB를 조회하지만 모델을 호출하지 않습니다. 결과에 반응하는 제한된 규칙으로 도구를 선택합니다."
                : "AI가 읽기 전용 도구를 선택합니다. 질문과 집계 근거가 OpenAI로 전송됩니다."}
            </p>
          </div>
          <div className="invest-layout">
            <aside className="invest-conversation">
              <div className="invest-section-heading">
                <h3>조사 대화</h3>
                <button
                  aria-label="새 조사"
                  onClick={() => {
                    generation.current++;
                    latest.current = null;
                    setSession(null);
                    if (!configured) setMode("demo");
                    scopeDirty.current = false;
                    setCustomScope(false);
                    setScope({
                      days: 7,
                      end: bootstrap.seed.end_date,
                      store: "",
                      channel: "",
                      comparison: "previous",
                    });
                    setDraft(null);
                    setSelectedEvidence("");
                    setAuto(true);
                    setPrompt("");
                    setError("");
                  }}
                >
                  <Plus size={17} />
                </button>
              </div>
              <details className="invest-history">
                <summary>이전 조사 {sessions.length}건</summary>
                {sessions.map((s) => (
                  <button key={s.id} onClick={() => void open(s.id)}>
                    <strong>{s.title}</strong>
                    <small>
                      {statusNames[s.status]} · {timestamp(s.updated_at)}
                    </small>
                  </button>
                ))}
              </details>
              <div className="invest-messages" aria-live="polite">
                {session ? (
                  session.state.messages.map((m) => (
                    <div key={m.id} className={"invest-message " + m.role}>
                      <strong>
                        {m.role === "user"
                          ? "영업기획 담당자"
                          : "조사 에이전트"}
                      </strong>
                      <p>{m.text}</p>
                    </div>
                  ))
                ) : (
                  <div className="invest-welcome">
                    <Bot size={32} />
                    <h3>어떤 변화가 궁금하신가요?</h3>
                    <p>
                      매출 감소 조사부터 시작해 모바일·고객 등급을 더 살펴보고,
                      결과를 저장하고 반복해서 확인할 업무로 맡겨보세요.
                    </p>
                  </div>
                )}
              </div>
              <div className="invest-suggestions">
                {[
                  "지난주 매출이 감소한 점포를 조사해줘",
                  "오프라인 말고 모바일 쪽만 더 봐줘",
                  "이 결과를 분석 화면으로 저장하고 매주 확인해줘",
                ].map((text) => (
                  <button
                    disabled={sending}
                    key={text}
                    onClick={() => void send(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="invest-prompt">
                  질문 또는 조사 방향 변경
                  <textarea
                    aria-label="조사 요청"
                    value={prompt}
                    minLength={3}
                    maxLength={1000}
                    required
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="모바일 쪽만 더 봐줘…"
                  />
                </label>
                <button
                  className="primary"
                  disabled={sending || prompt.trim().length < 3}
                >
                  <Send size={15} />
                  {session ? "후속 요청 보내기" : "조사 시작"}
                </button>
              </form>
            </aside>
            <section className="invest-progress">
              <div className="invest-section-heading">
                <h3>수행 단계</h3>
                <span className="app-chip">
                  {round ? statusNames[round.status] : "대기"}
                </span>
              </div>
              <details className="invest-scope">
                <summary>조사 범위 확인·수정</summary>
                <div className="invest-form">
                  <label>
                    최근 일수
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={scope.days}
                      onChange={(e) => {
                        setScope({ ...scope, days: Number(e.target.value) });
                        scopeDirty.current = true;
                        setCustomScope(true);
                      }}
                    />
                  </label>
                  <label>
                    종료일
                    <input
                      type="date"
                      value={scope.end}
                      onChange={(e) => {
                        setScope({ ...scope, end: e.target.value });
                        scopeDirty.current = true;
                        setCustomScope(true);
                      }}
                    />
                  </label>
                  <label>
                    점포
                    <select
                      value={scope.store}
                      onChange={(e) => {
                        setScope({ ...scope, store: e.target.value });
                        scopeDirty.current = true;
                        setCustomScope(true);
                      }}
                    >
                      <option value="">전체 점포</option>
                      {bootstrap.stores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    채널
                    <select
                      value={scope.channel}
                      onChange={(e) => {
                        setScope({ ...scope, channel: e.target.value });
                        scopeDirty.current = true;
                        setCustomScope(true);
                      }}
                    >
                      <option value="">전체 채널</option>
                      <option>모바일 앱</option>
                      <option>오프라인</option>
                    </select>
                  </label>
                </div>
                <p>변경한 범위는 다음 요청에 반영합니다.</p>
              </details>
              {round && (
                <p className="invest-range">
                  {round.scope.end}까지 {round.scope.days}일 ·{" "}
                  {round.scope.channel || "전체 채널"} ·{" "}
                  {round.scope.store
                    ? bootstrap.stores.find(
                        (s) => String(s.id) === round.scope.store,
                      )?.name
                    : "전체 점포"}
                </p>
              )}
              {!round && (
                <p className="empty">
                  조사를 시작하면 도구 선택과 조회 이유를 보여줍니다.
                </p>
              )}
              {session?.state.rounds.map((r, i) => (
                <div key={r.id} className="invest-round">
                  <h4>
                    요청 {i + 1} · {statusNames[r.status]}
                  </h4>
                  {r.steps.map((s, j) => (
                    <button
                      className={
                        "invest-step " +
                        (evidence?.id === s.id ? "selected" : "")
                      }
                      key={s.id}
                      onClick={() => setSelectedEvidence(s.id)}
                    >
                      <span className="invest-step-number">{j + 1}</span>
                      <div>
                        <strong>{tools[s.tool] || s.tool}</strong>
                        <p>{s.reason}</p>
                        <small>
                          {s.result.rows?.length ?? 0}개 집계 그룹 ·{" "}
                          {s.scope.channel || "전체 채널"}
                        </small>
                      </div>
                      <CheckCircle2 size={15} />
                    </button>
                  ))}
                  {r.error && <p className="analysis-error">{r.error}</p>}
                  {r.report && (
                    <div className="invest-conclusion">
                      <strong>
                        {session.state.mode === "demo"
                          ? "시연 해석"
                          : "AI 해석"}{" "}
                        · 원인은 검증이 필요한 가설
                      </strong>
                      <p>{r.report.summary}</p>
                      <div className="invest-citations">
                        {r.report.evidenceIds.map((id, j) => (
                          <button
                            key={id}
                            onClick={() => setSelectedEvidence(id)}
                          >
                            근거 {j + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {r.proposal && (
                    <div className="invest-export-summary">
                      <p>
                        {r.proposal.saved
                          ? "분석을 보관하고 반복 업무를 저장했습니다."
                          : "분석 보관과 반복 업무 초안이 준비됐습니다."}
                      </p>
                      {r.proposal.saved ? (
                        <button
                          onClick={() => {
                            setSelectedOutput(r.proposal!.saved!.appId);
                            setShowSaved(true);
                            setTab("chat");
                          }}
                        >
                          저장한 분석 열기
                        </button>
                      ) : (
                        i === session.state.rounds.length - 1 && (
                          <button
                            onClick={() => {
                              setDraft({ ...structuredClone(r.proposal!), config: { ...r.proposal!.config, investigationMode: session.state.mode, objective: session.state.rounds[0].prompt } });
                              setDraftEnabled(false);
                            }}
                          >
                            업무 맡기기 · 초안 확인
                          </button>
                        )
                      )}
                      {r.proposal.saved && <button onClick={() => { setSelectedAgent(r.proposal!.saved!.agentId); setTab("tasks"); }}>맡긴 업무 열기</button>}
                    </div>
                  )}
                </div>
              ))}
              {stepping && (
                <p role="status" className="invest-working">
                  조회 결과를 검토하고 다음 도구를 선택하고 있습니다…
                </p>
              )}
              {round && (
                <div className="invest-actions">
                  {round.status === "running" ? (
                    <>
                      <button onClick={() => void pause()}>
                        <Pause size={15} />
                        조사 잠시 멈춤
                      </button>
                      {!auto && (
                        <button onClick={() => setAuto(true)}>
                          <Play size={15} />
                          조사 이어가기
                        </button>
                      )}
                    </>
                  ) : (
                    ["paused", "error"].includes(round.status) && (
                      <button onClick={() => void pause(true)}>
                        <Play size={15} />
                        조사 이어가기
                      </button>
                    )
                  )}
                </div>
              )}
            </section>
            <section className="invest-evidence">
              <div className="invest-section-heading">
                <h3>조회 근거</h3>
                <span className="app-chip">서버 집계</span>
              </div>
              {evidence?.result.spec ? (
                <>
                  <p className="invest-evidence-id">근거 ID: {evidence.id}</p>
                  <p className="muted">
                    이 근거의 범위: {evidence.scope.channel || "전체 채널"} ·{" "}
                    {evidence.scope.end}까지 {evidence.scope.days}일
                  </p>
                  <AnalysisPreview data={evidence.result} meta={meta} />
                </>
              ) : (
                <div className="invest-welcome">
                  <Search size={30} />
                  <p>
                    단계나 근거 버튼을 선택하면 실제 조회 결과와 비교 기간을 볼
                    수 있습니다.
                  </p>
                </div>
              )}
            </section>
          </div>
          {draft && session && (
            <Panel title="업무 맡기기 · 설정 확인">
              <p className="app-warning">
                저장 전 설정을 확인하세요. 분석 화면은 현재 조사 기간을 고정해
                보관하고, 맡긴 업무는 실행할 때마다 비교 기간을 다시 계산합니다.
              </p>
              <fieldset className="invest-form" disabled={sending}>
                <label>
                  분석 이름
                  <input
                    maxLength={60}
                    value={draft.spec.title}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        spec: { ...draft.spec, title: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  실행 주기
                  <select
                    value={draft.config.frequency}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...draft.config, frequency: e.target.value },
                      })
                    }
                  >
                    <option value="weekly">매주</option>
                    <option value="daily">매일</option>
                  </select>
                </label>
                <label>
                  요일
                  <select
                    value={draft.config.weekday}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: {
                          ...draft.config,
                          weekday: Number(e.target.value),
                        },
                      })
                    }
                  >
                    {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                      <option key={d} value={i}>
                        {d}요일
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  한국 시간
                  <input
                    type="time"
                    value={draft.config.time}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: { ...draft.config, time: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  조사 방식
                  <select value={draft.config.investigationMode || mode} onChange={(e) => setDraft({ ...draft, config: { ...draft.config, investigationMode: e.target.value as "live" | "demo" | "off" } })}>
                    <option value="live" disabled={!configured}>실제 AI 조사</option>
                    <option value="demo">시연 · 규칙 기반 조사</option>
                    <option value="off">규칙 점검</option>
                  </select>
                </label>
                <label className="task-wide">
                  맡길 업무
                  <textarea maxLength={1000} value={draft.config.objective || session.state.rounds[0].prompt} onChange={(e) => setDraft({ ...draft, config: { ...draft.config, objective: e.target.value } })}/>
                </label>
                <p className="task-wide app-definition">발견한 그룹 중 최대 3개를 추가 조사하고 이전 실행과 비교합니다. 실제 AI 모드는 집계 근거를 OpenAI로 전송하며, 시연 모드는 모델을 호출하지 않습니다.</p>
                <label>
                  감소율 임계값 (%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.config.threshold}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        config: {
                          ...draft.config,
                          threshold: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label className="invest-check">
                  <input
                    type="checkbox"
                    checked={draftEnabled}
                    onChange={(e) => setDraftEnabled(e.target.checked)}
                  />
                  업무 활성화
                </label>
                <div className="invest-actions">
                  <button
                    className="primary"
                    onClick={async () => {
                      setSending(true);
                      setError("");
                      try {
                        accept(
                          await post<Session>(
                            "/api/investigations/" + session.id + "/approve",
                            {
                              version: session.version,
                              proposalId: draft.id,
                              title: draft.spec.title,
                              config: draft.config,
                              enabled: draftEnabled,
                            },
                          ),
                        );
                        setDraft(null);
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setSending(false);
                      }
                    }}
                  >
                    확인하고 업무 맡기기
                  </button>
                  <button onClick={() => setDraft(null)}>닫기</button>
                </div>
              </fieldset>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
