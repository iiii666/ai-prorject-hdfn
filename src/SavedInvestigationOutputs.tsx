import { useEffect, useState } from "react";
import { request } from "./api";
import type { SavedApp, Agent, Data, Meta, Config } from "./analysis-types";
import AnalysisPreview from "./AnalysisPreview";
import { Panel, timestamp } from "./components";
import AgentRunReport from "./AgentRunReport";
import type { Run } from "./analysis-types";
export function SavedAnalyses({
  meta,
  selectedId,
}: {
  meta: Meta;
  selectedId: string;
}) {
  const [items, setItems] = useState<SavedApp[]>([]),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    request<SavedApp[]>("/api/my-apps")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (selectedId)
      request<Data>("/api/my-apps/" + selectedId + "/data")
        .then(setData)
        .catch((e) => setError(e.message));
  }, [selectedId]);
  return (
    <div className="invest-saved">
      <Panel title="저장한 분석">
        <p className="muted">
          조사 결과에서 확인하고 저장한 분석 화면입니다. 이전에 저장한 분석 앱도
          여기에서 볼 수 있습니다.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="invest-output-grid">
          {items.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setError("");
                request<Data>("/api/my-apps/" + a.id + "/data")
                  .then(setData)
                  .catch((e) => setError(e.message));
              }}
            >
              <strong>{a.title}</strong>
              <span>
                v{a.version} · {timestamp(a.updated_at)}
              </span>
              <small>
                {a.spec.end
                  ? "조사 기간 고정 · " + a.spec.end + "까지"
                  : "최신 DB 기준 갱신"}
              </small>
            </button>
          ))}
        </div>
        {!items.length && (
          <p className="empty">
            조사 대화에서 “이 결과를 저장하고 매주 확인해줘”라고 요청해보세요.
          </p>
        )}
      </Panel>
      {data && <AnalysisPreview data={data} meta={meta} />}
    </div>
  );
}
export function SavedMonitors({
  meta,
  selectedId,
}: {
  meta: Meta;
  selectedId: string;
}) {
  const [items, setItems] = useState<Agent[]>([]),
    [selected, setSelected] = useState<Agent | null>(null),
    [runs, setRuns] = useState<Run[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const a = await request<Agent[]>("/api/metric-agents");
    setItems(a);
    return a;
  }
  async function open(a: Agent) {
    setSelected(a);
    setRuns(await request("/api/metric-agents/" + a.id + "/runs"));
  }
  useEffect(() => {
    refresh()
      .then((a) => {
        const s = a.find((x) => x.id === selectedId);
        if (s) return open(s);
      })
      .catch((e) => setError(e.message));
  }, [selectedId]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(patch: Partial<Config>) {
    if (selected)
      setSelected({ ...selected, config: { ...selected.config, ...patch } });
  }
  return (
    <div className="invest-monitor">
      <Panel title="정기 감시">
        <p className="muted">
          조사 에이전트에서 만든 감시와 기존 감시를 관리합니다. 정기 감시는
          서버가 실행 중일 때 동작합니다.
        </p>
        {error && (
          <p className="analysis-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="app-success" role="status">
            {notice}
          </p>
        )}
        <div className="invest-output-grid">
          {items.map((a) => (
            <button
              disabled={busy}
              key={a.id}
              onClick={() => void act(() => open(a))}
            >
              <strong>
                {a.enabled ? "●" : "○"} {a.name}
              </strong>
              <span>
                {a.enabled ? "다음 " + timestamp(a.next_run) : "일시 중지"}
              </span>
            </button>
          ))}
        </div>
        {!items.length && (
          <p className="empty">
            조사 결과를 저장할 때 정기 감시 초안을 함께 만들 수 있습니다.
          </p>
        )}
      </Panel>
      {selected && (
        <Panel title="감시 설정">
          <fieldset disabled={busy} className="invest-form">
            <label>
              감시 이름
              <input
                value={selected.config.name}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </label>
            <label>
              주기
              <select
                value={selected.config.frequency}
                onChange={(e) => edit({ frequency: e.target.value })}
              >
                <option value="weekly">매주</option>
                <option value="daily">매일</option>
              </select>
            </label>
            <label>
              요일
              <select
                value={selected.config.weekday}
                onChange={(e) => edit({ weekday: Number(e.target.value) })}
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
                value={selected.config.time}
                onChange={(e) => edit({ time: e.target.value })}
              />
            </label>
            <label>
              감시 지표
              <input
                readOnly
                value={meta.metrics[selected.config.metric].label}
              />
            </label>
            <label>
              조건
              <select
                value={selected.config.condition}
                onChange={(e) => edit({ condition: e.target.value })}
              >
                <option value="drop">상대 감소율 이상 (%)</option>
                <option value="below">지표 값 미만</option>
                <option value="above">지표 값 초과</option>
              </select>
            </label>
            <label>
              임계값
              <input
                type="number"
                min={0}
                value={selected.config.threshold}
                onChange={(e) => edit({ threshold: Number(e.target.value) })}
              />
            </label>
            <label>
              분석 기간
              <select
                value={selected.config.period}
                onChange={(e) => edit({ period: e.target.value })}
              >
                <option value="week">직전 완료 주 vs 그 이전 주</option>
                <option value="rolling">어제 종료 · 앱 기간 비교</option>
              </select>
            </label>
            <label className="invest-check">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) =>
                  setSelected({ ...selected, enabled: e.target.checked })
                }
              />
              정기 감시 활성화
            </label>
            <div className="invest-actions">
              <button
                className="primary"
                onClick={() =>
                  void act(async () => {
                    const saved = await request<Agent>(
                      "/api/metric-agents/" + selected.id,
                      {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          appId: selected.app_id,
                          config: selected.config,
                          enabled: selected.enabled,
                        }),
                      },
                    );
                    await refresh();
                    setSelected(saved);
                    setNotice("감시 설정을 저장했습니다.");
                  })
                }
              >
                감시 저장
              </button>
              <button
                onClick={() =>
                  void act(async () => {
                    const original = items.find((a) => a.id === selected.id);
                    if (
                      JSON.stringify(original?.config) !==
                      JSON.stringify(selected.config)
                    )
                      throw Error("변경한 설정을 먼저 저장하세요.");
                    await request(
                      "/api/metric-agents/" + selected.id + "/test",
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: "{}",
                      },
                    );
                    await open(selected);
                    setNotice("시험 실행을 완료했습니다.");
                  })
                }
              >
                지금 시험 실행
              </button>
              <button onClick={() => void act(() => open(selected))}>
                이력 다시 조회
              </button>
            </div>
          </fieldset>
          {runs.map((r, i) => (
            <AgentRunReport key={r.id} run={r} meta={meta} open={i === 0} />
          ))}
        </Panel>
      )}
    </div>
  );
}
