import { useEffect, useState } from "react";
import {
  Sparkles,
  Plus,
  Save,
  Play,
  Bell,
  LayoutDashboard,
  History,
  Trash2,
  RefreshCw,
  Bot,
  CheckCircle2,
} from "lucide-react";
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
import { request, type Bootstrap } from "./api";
import { Panel, DataTable, timestamp } from "./components";
import "./my-apps.css";
type Spec = {
  title: string;
  metrics: string[];
  dimension: string;
  days: number;
  comparison: string;
  store: string;
  channel: string;
  chart: string;
};
type SavedApp = {
  id: string;
  title: string;
  spec: Spec;
  version: number;
  updated_at: string;
};
type Meta = {
  metrics: Record<
    string,
    { label: string; unit: string; definition: string; source: string }
  >;
  dimensions: Record<string, string>;
  aiConfigured: boolean;
};
type Metric = {
  value: number | null;
  previous: number | null;
  change: number | null;
  difference: number | null;
};
type Data = {
  spec: Spec;
  range: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
  };
  rows: { id: string; label: string; metrics: Record<string, Metric> }[];
  complete: boolean;
  notes: string[];
  queriedAt: string;
};
type Config = {
  name: string;
  frequency: string;
  weekday: number;
  time: string;
  metric: string;
  condition: string;
  threshold: number;
  period: string;
};
type Agent = {
  id: string;
  app_id: string;
  name: string;
  config: Config;
  enabled: boolean;
  next_run: string;
};
type Run = {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  finished_at: string;
  report: {
    summary?: string;
    appTitle?: string;
    appVersion?: number;
    config?: Config;
    range?: Data["range"];
    rows?: (Data["rows"][number] & { matched: boolean | null })[];
    investigations?: {
      group: string;
      details: {
        dimension: string;
        rows: {
          label: string;
          value: number;
          previous: number;
          difference: number;
        }[];
      }[];
    }[];
    steps?: string[];
    notes?: string[];
  };
};
const initial: Spec = {
  title: "점포 매출 현황",
  metrics: ["sales", "orders"],
  dimension: "store",
  days: 30,
  comparison: "previous",
  store: "",
  channel: "",
  chart: "bar",
};
const initialConfig: Config = {
  name: "주간 매출 감소 점검",
  frequency: "weekly",
  weekday: 1,
  time: "09:00",
  metric: "sales",
  condition: "drop",
  threshold: 10,
  period: "week",
};
const post = <T,>(url: string, data: unknown, method = "POST") =>
  request<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
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
function Preview({ data, meta }: { data: Data; meta: Meta }) {
  return (
    <div className="app-preview">
      <div className="app-preview-heading">
        <div>
          <span className="app-eyebrow">LIVE ANALYSIS</span>
          <h2>{data.spec.title}</h2>
          <p>
            {data.range.start} ~ {data.range.end} · 비교{" "}
            {data.range.previousStart} ~ {data.range.previousEnd}
          </p>
        </div>
        <span className="app-chip">서버 집계</span>
      </div>
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
                {metric.definition} · 출처 {metric.source}
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
export default function MyAnalysisApps({
  bootstrap,
}: {
  bootstrap: Bootstrap;
}) {
  const [tab, setTab] = useState<"apps" | "agents">("apps");
  const [meta, setMeta] = useState<Meta | null>(null),
    [apps, setApps] = useState<SavedApp[]>([]),
    [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<SavedApp | null>(null),
    [spec, setSpec] = useState<Spec>(initial),
    [data, setData] = useState<Data | null>(null);
  const [prompt, setPrompt] = useState(
    "점포별 매출과 주문 수를 최근 30일 기준으로 비교하는 화면 만들어줘.",
  );
  const [messages, setMessages] = useState<{ role: string; text: string }[]>(
      [],
    ),
    [versions, setVersions] = useState<
      (SavedApp & { prompt: string; created_at: string })[]
    >([]);
  const [agentId, setAgentId] = useState(""),
    [appId, setAppId] = useState(""),
    [config, setConfig] = useState<Config>(initialConfig),
    [enabled, setEnabled] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState(
    "매주 월요일 오전 9시에 지난주 매출이 그 전주보다 10% 이상 감소한 점포를 확인해줘.",
  );
  const [runs, setRuns] = useState<Run[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function refresh() {
    const [m, a, g] = await Promise.all([
      request<Meta>("/api/my-apps/meta"),
      request<SavedApp[]>("/api/my-apps"),
      request<Agent[]>("/api/metric-agents"),
    ]);
    setMeta(m);
    setApps(a);
    setAgents(g);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (tab !== "agents" || !agentId) return;
    let active = true;
    const timer = setInterval(() => {
      request<Run[]>(`/api/metric-agents/${agentId}/runs`)
        .then((r) => {
          if (active) setRuns(r);
        })
        .catch(() => {});
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tab, agentId]);
  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function edit(patch: Partial<Spec>) {
    setSpec((s) => ({ ...s, ...patch }));
    setData(null);
  }
  async function open(app: SavedApp) {
    setSelected(app);
    setSpec(app.spec);
    setMessages([]);
    setVersions([]);
    setData(null);
    setData(await request<Data>(`/api/my-apps/${app.id}/data`));
  }
  async function showAgent(a: Agent) {
    setAgentId(a.id);
    setAppId(a.app_id);
    setConfig(a.config);
    setEnabled(a.enabled);
    setRuns(await request<Run[]>(`/api/metric-agents/${a.id}/runs`));
  }
  if (!meta)
    return (
      <div className="empty">{error || "내 분석 앱을 준비하고 있습니다…"}</div>
    );
  const linkedApp = apps.find((a) => a.id === appId);
  const dirty =
    !!selected && JSON.stringify(selected.spec) !== JSON.stringify(spec);
  return (
    <div className="my-apps">
      <div className="app-intro">
        <div>
          <span className="app-eyebrow">BUILD YOUR WORKFLOW</span>
          <h2>질문에서 화면으로, 화면에서 자동 점검으로</h2>
          <p>
            필요한 분석을 만들고 저장하세요. 감시 에이전트가 정해진 시간에
            변화를 확인합니다.
          </p>
        </div>
        <Bot size={36} />
      </div>
      <div className="app-tabs" role="tablist" aria-label="내 분석 앱 기능">
        <button
          role="tab"
          aria-selected={tab === "apps"}
          onClick={() => setTab("apps")}
        >
          <LayoutDashboard size={16} />
          분석 앱 <span>{apps.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "agents"}
          onClick={() => setTab("agents")}
        >
          <Bell size={16} />
          지표 감시 에이전트{" "}
          <span>{agents.filter((a) => a.enabled).length}개 활성</span>
        </button>
      </div>
      {error && (
        <p className="analysis-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="app-success" role="status">
          <CheckCircle2 size={16} />
          {notice}
        </p>
      )}
      {busy && (
        <p className="muted" role="status">
          {busy} 중…
        </p>
      )}
      <fieldset className="app-workspace" disabled={!!busy}>
        {tab === "apps" ? (
          <>
            <aside className="app-library">
              <div className="app-section-title">
                <h3>저장한 분석 앱</h3>
                <button
                  className="icon-button"
                  aria-label="새 분석 앱"
                  onClick={() => {
                    setSelected(null);
                    setSpec(initial);
                    setData(null);
                    setMessages([]);
                    setVersions([]);
                  }}
                >
                  <Plus size={18} />
                </button>
              </div>
              {!apps.length && (
                <p className="muted">
                  첫 분석 앱을 만들어보세요. 저장한 앱은 여기에서 다시 열 수
                  있습니다.
                </p>
              )}
              {apps.map((a) => (
                <button
                  className={`app-library-item ${selected?.id === a.id ? "selected" : ""}`}
                  key={a.id}
                  onClick={() => void action("앱 조회", () => open(a))}
                >
                  <strong>{a.title}</strong>
                  <small>
                    v{a.version} · {timestamp(a.updated_at)}
                  </small>
                </button>
              ))}
              <div className="app-library-tip">
                <Sparkles size={18} />
                <strong>이렇게 요청해보세요</strong>
                <p>“상품군별 매출을 보여줘”</p>
                <p>“선 차트로 바꿔줘”</p>
                <p>“모바일 앱만 비교해줘”</p>
              </div>
            </aside>
            <div className="app-builder">
              <Panel
                title={selected ? "분석 앱 수정" : "새 분석 앱 만들기"}
                aside={
                  <span className="app-chip">
                    {selected
                      ? `v${selected.version}${dirty ? " · 저장 전 변경" : ""}`
                      : "초안"}
                  </span>
                }
              >
                <div className="app-conversation" aria-live="polite">
                  {messages.length ? (
                    messages.map((m, i) => (
                      <div key={i} className={`app-message ${m.role}`}>
                        <strong>{m.role === "user" ? "나" : "에이전트"}</strong>
                        <p>{m.text}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      만들고 싶은 분석 화면을 설명하세요. 아래 설정으로 직접
                      구성할 수도 있습니다.
                    </p>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action("AI 화면 구성", async () => {
                      const out = await post<{ spec: Spec; message: string }>(
                        "/api/my-apps/plan",
                        { prompt, current: spec },
                      );
                      setMessages((m) => [
                        ...m,
                        { role: "user", text: prompt },
                        { role: "assistant", text: out.message },
                      ]);
                      setSpec(out.spec);
                      setData(null);
                      setData(
                        await post<Data>("/api/my-apps/preview", {
                          spec: out.spec,
                        }),
                      );
                    });
                  }}
                >
                  <label className="app-field">
                    에이전트에게 요청
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      minLength={5}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="primary" disabled={!meta.aiConfigured}>
                    <Sparkles size={15} />
                    대화로 구성
                  </button>
                  {!meta.aiConfigured && (
                    <p className="muted">
                      OpenAI 키가 없어도 직접 구성·저장·감시 기능을 사용할 수
                      있습니다.
                    </p>
                  )}
                </form>
                <details className="app-details" open={!selected}>
                  <summary>직접 구성 · AI가 선택한 설정 확인</summary>
                  <div className="app-form-grid">
                    <label className="app-field">
                      앱 이름
                      <input
                        value={spec.title}
                        maxLength={60}
                        onChange={(e) => edit({ title: e.target.value })}
                      />
                    </label>
                    <label className="app-field">
                      분석 축
                      <select
                        value={spec.dimension}
                        onChange={(e) => edit({ dimension: e.target.value })}
                      >
                        {Object.entries(meta.dimensions).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="app-field">
                      최근 일수
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={spec.days}
                        onChange={(e) => edit({ days: Number(e.target.value) })}
                      />
                    </label>
                    <label className="app-field">
                      비교 기준
                      <select
                        value={spec.comparison}
                        onChange={(e) => edit({ comparison: e.target.value })}
                      >
                        <option value="previous">직전 동일 기간</option>
                        <option value="year">전년 동기</option>
                      </select>
                    </label>
                    <label className="app-field">
                      점포
                      <select
                        value={spec.store}
                        onChange={(e) => edit({ store: e.target.value })}
                      >
                        <option value="">전체 점포</option>
                        {bootstrap.stores.map((s) => (
                          <option value={String(s.id)} key={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="app-field">
                      채널
                      <select
                        value={spec.channel}
                        onChange={(e) => edit({ channel: e.target.value })}
                      >
                        <option value="">전체 채널</option>
                        {bootstrap.channels.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label className="app-field">
                      표현 방식
                      <select
                        value={spec.chart}
                        onChange={(e) => edit({ chart: e.target.value })}
                      >
                        <option value="bar">막대 차트 + 표</option>
                        <option value="line">선 차트 + 표</option>
                        <option value="table">표</option>
                      </select>
                    </label>
                  </div>
                  <div className="app-metric-picks" aria-label="분석 지표">
                    {Object.entries(meta.metrics).map(([id, m]) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={spec.metrics.includes(id)}
                          onChange={(e) =>
                            edit({
                              metrics: e.target.checked
                                ? [...spec.metrics, id]
                                : spec.metrics.filter((v) => v !== id),
                            })
                          }
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                  <p className="muted">
                    지표 1~4개 · 상품군별은 매출·완료 주문·객단가 지원 ·
                    기준일은 DB 최신 데이터일
                  </p>
                </details>
                <div className="app-actions">
                  <button
                    onClick={() =>
                      void action("미리보기", async () =>
                        setData(
                          await post<Data>("/api/my-apps/preview", { spec }),
                        ),
                      )
                    }
                  >
                    <Play size={15} />
                    미리보기
                  </button>
                  <button
                    className="primary"
                    onClick={() =>
                      void action("저장", async () => {
                        const a = await post<SavedApp>(
                          selected
                            ? `/api/my-apps/${selected.id}`
                            : "/api/my-apps",
                          { spec, prompt, version: selected?.version },
                          selected ? "PUT" : "POST",
                        );
                        setSelected(a);
                        setSpec(a.spec);
                        setVersions([]);
                        await refresh();
                        setNotice(
                          "분석 앱을 저장했습니다. 다시 열면 최신 DB 데이터를 조회합니다.",
                        );
                      })
                    }
                  >
                    <Save size={15} />앱 저장
                  </button>
                  {selected && (
                    <>
                      <button
                        onClick={() =>
                          void action("버전 조회", async () =>
                            setVersions(
                              await request(
                                `/api/my-apps/${selected.id}/versions`,
                              ),
                            ),
                          )
                        }
                      >
                        <History size={15} />
                        버전 이력
                      </button>
                      <button
                        onClick={() => {
                          setAppId(selected.id);
                          setAgentId("");
                          setConfig({
                            ...initialConfig,
                            metric: selected.spec.metrics[0],
                          });
                          setEnabled(false);
                          setRuns([]);
                          setTab("agents");
                        }}
                      >
                        <Bell size={15} />
                        감시 연결
                      </button>
                      <button
                        aria-label="분석 앱 삭제"
                        onClick={() => {
                          if (
                            confirm("앱과 연결된 감시·실행 이력을 삭제할까요?")
                          )
                            void action("삭제", async () => {
                              await request(`/api/my-apps/${selected.id}`, {
                                method: "DELETE",
                              });
                              setSelected(null);
                              setSpec(initial);
                              setData(null);
                              setVersions([]);
                              await refresh();
                            });
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
                {!!versions.length && (
                  <div className="app-versions">
                    {versions.map((v) => (
                      <div key={v.id}>
                        <span>
                          v{v.version} · {timestamp(v.created_at)} · {v.prompt}
                        </span>
                        <button
                          onClick={() => {
                            setSpec(v.spec);
                            setData(null);
                            setNotice(
                              "이전 버전을 초안으로 불러왔습니다. 저장하면 새 버전이 됩니다.",
                            );
                          }}
                        >
                          초안으로 복원
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              {data ? (
                <Preview data={data} meta={meta} />
              ) : (
                <div className="app-preview-empty">
                  <LayoutDashboard size={36} />
                  <h3>만들어질 분석 화면을 확인하세요</h3>
                  <p>AI로 구성하거나 설정을 고른 뒤 미리보기를 누르세요.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <aside className="app-library">
              <div className="app-section-title">
                <h3>내 감시 에이전트</h3>
                <button
                  className="icon-button"
                  aria-label="새 감시 에이전트"
                  onClick={() => {
                    setAgentId("");
                    setAppId(apps[0]?.id || "");
                    setConfig({
                      ...initialConfig,
                      metric: apps[0]?.spec.metrics[0] || "sales",
                    });
                    setEnabled(false);
                    setRuns([]);
                  }}
                >
                  <Plus size={18} />
                </button>
              </div>
              {!agents.length && (
                <p className="muted">분석 앱을 저장한 뒤 감시를 연결하세요.</p>
              )}
              {agents.map((a) => (
                <button
                  className={`app-library-item ${agentId === a.id ? "selected" : ""}`}
                  key={a.id}
                  onClick={() => void action("감시 조회", () => showAgent(a))}
                >
                  <strong>
                    {a.enabled ? "●" : "○"} {a.name}
                  </strong>
                  <small>
                    {a.enabled ? `다음 ${timestamp(a.next_run)}` : "일시 중지"}
                  </small>
                </button>
              ))}
              <p className="app-library-tip">
                한국 시간 기준으로 실행합니다. 서버가 실행 중이어야 하며, 중단
                중 놓친 일정은 재시작 후 한 번 실행합니다.
              </p>
            </aside>
            <div className="app-builder">
              <Panel
                title={agentId ? "감시 에이전트 설정" : "새 감시 에이전트"}
                aside={<span className="app-chip">Asia/Seoul</span>}
              >
                {!apps.length ? (
                  <p className="empty">
                    분석 앱 탭에서 먼저 앱을 만들고 저장하세요.
                  </p>
                ) : (
                  <>
                    <label className="app-field">
                      연결할 분석 앱
                      <select
                        value={appId}
                        onChange={(e) => {
                          const a = apps.find((a) => a.id === e.target.value);
                          setAppId(e.target.value);
                          if (a)
                            setConfig((c) => ({
                              ...c,
                              metric: a.spec.metrics[0],
                            }));
                        }}
                      >
                        <option value="">앱 선택</option>
                        {apps.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title} · v{a.version}
                          </option>
                        ))}
                      </select>
                    </label>
                    <form
                      className="app-agent-prompt"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action("AI 감시 설정", async () => {
                          const out = await post<{
                            config: Config;
                            message: string;
                          }>("/api/metric-agents/plan", {
                            appId,
                            prompt: agentPrompt,
                          });
                          setConfig(out.config);
                          setNotice(out.message);
                        });
                      }}
                    >
                      <label className="app-field">
                        어떤 변화를 확인할까요?
                        <textarea
                          minLength={5}
                          maxLength={1000}
                          required
                          value={agentPrompt}
                          onChange={(e) => setAgentPrompt(e.target.value)}
                        />
                      </label>
                      <button disabled={!meta.aiConfigured || !appId}>
                        <Sparkles size={15} />
                        대화로 감시 설정
                      </button>
                    </form>
                    <div className="app-form-grid">
                      <label className="app-field">
                        감시 이름
                        <input
                          maxLength={80}
                          value={config.name}
                          onChange={(e) =>
                            setConfig({ ...config, name: e.target.value })
                          }
                        />
                      </label>
                      <label className="app-field">
                        실행 주기
                        <select
                          value={config.frequency}
                          onChange={(e) =>
                            setConfig({ ...config, frequency: e.target.value })
                          }
                        >
                          <option value="weekly">매주</option>
                          <option value="daily">매일</option>
                        </select>
                      </label>
                      {config.frequency === "weekly" && (
                        <label className="app-field">
                          요일
                          <select
                            value={config.weekday}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                weekday: Number(e.target.value),
                              })
                            }
                          >
                            {["일", "월", "화", "수", "목", "금", "토"].map(
                              (v, i) => (
                                <option key={v} value={i}>
                                  {v}요일
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      )}
                      <label className="app-field">
                        한국 시간
                        <input
                          type="time"
                          value={config.time}
                          onChange={(e) =>
                            setConfig({ ...config, time: e.target.value })
                          }
                        />
                      </label>
                      <label className="app-field">
                        분석 기간
                        <select
                          value={config.period}
                          onChange={(e) =>
                            setConfig({ ...config, period: e.target.value })
                          }
                        >
                          <option value="week">
                            직전 완료 주 vs 그 이전 주
                          </option>
                          <option value="rolling">
                            어제 종료 · 앱 기간과 비교 설정
                          </option>
                        </select>
                      </label>
                      <label className="app-field">
                        감시 지표
                        <select
                          value={config.metric}
                          onChange={(e) =>
                            setConfig({ ...config, metric: e.target.value })
                          }
                        >
                          {(linkedApp?.spec.metrics || ["sales"]).map((m) => (
                            <option key={m} value={m}>
                              {meta.metrics[m].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="app-field">
                        발견 조건
                        <select
                          value={config.condition}
                          onChange={(e) =>
                            setConfig({ ...config, condition: e.target.value })
                          }
                        >
                          <option value="drop">
                            상대 감소율 이상 (경계 포함)
                          </option>
                          <option value="below">값이 임계값 미만</option>
                          <option value="above">값이 임계값 초과</option>
                        </select>
                      </label>
                      <label className="app-field">
                        임계값 (
                        {config.condition === "drop"
                          ? "%"
                          : meta.metrics[config.metric]?.unit}
                        )
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={config.threshold}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              threshold: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="app-toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                      />
                      정기 감시 활성화
                    </label>
                    <p className="app-definition">
                      저장된 앱의 최신 버전으로 실행합니다. 시험 실행은 아래
                      설정을 먼저 저장한 후 사용할 수 있으며 정기 실행 시각을
                      바꾸지 않습니다. 일별 분석 앱은 감시에 연결할 수 없습니다.
                    </p>
                    <div className="app-actions">
                      <button
                        className="primary"
                        disabled={!appId}
                        onClick={() =>
                          void action("감시 저장", async () => {
                            const a = await post<Agent>(
                              agentId
                                ? `/api/metric-agents/${agentId}`
                                : "/api/metric-agents",
                              { appId, config, enabled },
                              agentId ? "PUT" : "POST",
                            );
                            await refresh();
                            await showAgent(a);
                            setNotice(
                              enabled
                                ? "정기 감시를 활성화했습니다."
                                : "감시 설정을 저장했습니다. 시험 실행으로 확인하세요.",
                            );
                          })
                        }
                      >
                        <Save size={15} />
                        감시 저장
                      </button>
                      {agentId && (
                        <>
                          <button
                            onClick={() =>
                              void action("시험 실행", async () => {
                                const a = agents.find((a) => a.id === agentId);
                                if (
                                  !a ||
                                  JSON.stringify(a.config) !==
                                    JSON.stringify(config) ||
                                  a.app_id !== appId
                                )
                                  throw Error("변경한 설정을 먼저 저장하세요.");
                                await post(
                                  `/api/metric-agents/${agentId}/test`,
                                  {},
                                );
                                setRuns(
                                  await request(
                                    `/api/metric-agents/${agentId}/runs`,
                                  ),
                                );
                                setNotice(
                                  "시험 실행을 완료했습니다. 아래 보고서를 확인하세요.",
                                );
                              })
                            }
                          >
                            <Play size={15} />
                            지금 시험 실행
                          </button>
                          <button
                            onClick={() =>
                              void action("이력 새로고침", async () => {
                                setRuns(
                                  await request(
                                    `/api/metric-agents/${agentId}/runs`,
                                  ),
                                );
                                await refresh();
                              })
                            }
                          >
                            <RefreshCw size={15} />
                            이력 새로고침
                          </button>
                          <button
                            aria-label="감시 삭제"
                            onClick={() => {
                              if (confirm("감시와 실행 이력을 삭제할까요?"))
                                void action("감시 삭제", async () => {
                                  await request(
                                    `/api/metric-agents/${agentId}`,
                                    { method: "DELETE" },
                                  );
                                  setAgentId("");
                                  setRuns([]);
                                  await refresh();
                                });
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </Panel>
              <Panel
                title="실행 이력 · 앱 내 알림"
                aside={<span className="muted">최근 50건 · 15초마다 갱신</span>}
              >
                {!runs.length ? (
                  <p className="empty">
                    감시를 선택하고 시험 실행하면 보고서가 여기에 표시됩니다.
                  </p>
                ) : (
                  runs.map((r, i) => (
                    <details
                      className={`app-run ${r.status}`}
                      key={r.id}
                      open={i === 0}
                    >
                      <summary>
                        <span className="app-chip">
                          {statuses[r.status] || r.status}
                        </span>{" "}
                        {r.kind === "test" ? "시험" : "정기"} ·{" "}
                        {timestamp(r.created_at)}
                        <strong>{r.report.summary || "분석 중…"}</strong>
                      </summary>
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
                      {agentId && (
                        <button
                          onClick={() => {
                            const a = apps.find(
                              (a) =>
                                a.id ===
                                agents.find((a) => a.id === agentId)?.app_id,
                            );
                            if (a) {
                              setTab("apps");
                              void action("앱 조회", () => open(a));
                            }
                          }}
                        >
                          연결된 분석 앱 열기
                        </button>
                      )}
                    </details>
                  ))
                )}
              </Panel>
            </div>
          </>
        )}
      </fieldset>
    </div>
  );
}
