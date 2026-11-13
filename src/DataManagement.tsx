import { useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { request } from "./api";
import type { Catalog, Settings, Bootstrap } from "./api";
import { related } from "./data";
import { Panel, DataTable, num, timestamp } from "./components";
export function CatalogPage({
  data,
  onOpen,
}: {
  data: Catalog;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState("");
  const list = data.assets.filter(
    (a) =>
      (!type || a.type === type) &&
      `${a.name} ${a.description} ${a.owner} ${a.domain}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <Panel
      title="DB 데이터 자산"
      aside={
        <span className="muted">{list.length}개 자산 · 현재 DB 행 수</span>
      }
    >
      <div className="catalog-tools">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="데이터 자산 검색"
            placeholder="테이블명, 설명, 오너, 도메인 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="자산 유형"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">전체 유형</option>
          {[...new Set(data.assets.map((a) => a.type))].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <DataTable
        headers={["자산명", "유형", "설명", "행 수", "오너", "리니지"]}
        rows={list.map((a) => [
          <strong>{a.name}</strong>,
          <span className="type-tag">{a.type}</span>,
          a.description,
          num(a.rows),
          a.owner,
          <button className="text-button blue" onClick={() => onOpen(a.id)}>
            흐름 보기 →
          </button>,
        ])}
      />
    </Panel>
  );
}
export function LineagePage({
  data,
  initial,
}: {
  data: Catalog;
  initial: string;
}) {
  const [selected, setSelected] = useState(initial),
    [direction, setDirection] = useState("both"),
    [showAll, setShowAll] = useState(false);
  const asset = data.assets.find((a) => a.id === selected) || data.assets[0];
  if (!asset) return <div className="empty">등록된 자산이 없습니다.</div>;
  const up = related(asset.id, "up", data.edges),
    down = related(asset.id, "down", data.edges);
  const visible = data.assets.filter(
    (a) =>
      showAll ||
      a.id === asset.id ||
      (direction !== "down" && up.includes(a.id)) ||
      (direction !== "up" && down.includes(a.id)),
  );
  const stages = ["SOURCE", "WAREHOUSE", "DATA MART", "CONSUMPTION"];
  const nodes = visible.map((a) => ({
    ...a,
    x: 25 + stages.indexOf(a.type) * 230,
    y:
      80 +
      visible.filter((b) => b.type === a.type).findIndex((b) => b.id === a.id) *
        135,
  }));
  const height = Math.max(440, ...nodes.map((a) => a.y + 155));
  const ids = nodes.map((a) => a.id);
  const lookup = new Map(nodes.map((a) => [a.id, a]));
  return (
    <div className="lineage-page">
      <div className="lineage-kpis">
        {[
          ["추적 중인 DB 자산", num(data.assets.length), "테이블 및 SQL 뷰"],
          [
            "적재 실행 기록",
            num(data.pipelines.length),
            `성공 ${data.pipelines.filter((p) => p.status === "success").length}건`,
          ],
          ["SQL 의존 관계", num(data.edges.length), "실제 뷰 정의 기준"],
          ["영향 받는 자산", num(down.length), "선택 자산의 전체 하류"],
        ].map(([a, b, c]) => (
          <article key={a}>
            <span>{a}</span>
            <strong>{b}</strong>
            <small>{c}</small>
          </article>
        ))}
      </div>
      <div className="lineage-layout">
        <section className="flow-panel">
          <div className="panel-head">
            <div>
              <h2>End-to-End 데이터 흐름</h2>
              <p>PostgreSQL 테이블 → DW 뷰 → 집계 뷰 → 리포트 뷰</p>
            </div>
            <div className="flow-filters">
              <select
                aria-label="리니지 표시 범위"
                value={showAll ? "all" : "related"}
                onChange={(e) => setShowAll(e.target.value === "all")}
              >
                <option value="related">관련 자산</option>
                <option value="all">전체 자산</option>
              </select>
              <select
                aria-label="리니지 방향"
                value={direction}
                disabled={showAll}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="both">상·하류 모두</option>
                <option value="up">상류만</option>
                <option value="down">하류만</option>
              </select>
            </div>
          </div>
          <div className="flow-scroll">
            <div className="flow-canvas" style={{ width: 950, height }}>
              <div
                className="flow-columns"
                style={{ gridTemplateColumns: "repeat(4,1fr)" }}
              >
                {stages.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <svg
                className="connections"
                width="950"
                height={height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#35c4bd" />
                  </marker>
                </defs>
                {data.edges
                  .filter(
                    (e) => ids.includes(e.source) && ids.includes(e.target),
                  )
                  .map((e) => {
                    const a = lookup.get(e.source)!,
                      b = lookup.get(e.target)!;
                    return (
                      <path
                        key={e.source + e.target}
                        d={`M ${a.x + 172} ${a.y + 53} C ${a.x + 210} ${a.y + 53}, ${b.x - 40} ${b.y + 53}, ${b.x} ${b.y + 53}`}
                        fill="none"
                        stroke="#35c4bd"
                        strokeWidth="2"
                        markerEnd="url(#arrow)"
                      />
                    );
                  })}
              </svg>
              {nodes.map((a) => (
                <button
                  key={a.id}
                  className={`flow-node ${a.id === asset.id ? "selected" : ""}`}
                  style={{ left: a.x, top: a.y }}
                  onClick={() => setSelected(a.id)}
                >
                  <small
                    className={`engine ${a.type.toLowerCase().replace(" ", "-")}`}
                  >
                    POSTGRESQL · {a.type === "SOURCE" ? "TABLE" : "VIEW"}
                  </small>
                  <strong>{a.name}</strong>
                  <span>
                    {num(a.rows)} rows · {a.domain}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
        <aside className="asset-panel">
          <div className="panel-head">
            <h2>선택한 자산</h2>
            <span>{asset.type}</span>
          </div>
          <div className="asset-body">
            <h3>{asset.name}</h3>
            <p>{asset.description}</p>
            <dl>
              {[
                ["저장 엔진", "PostgreSQL"],
                ["최초 적재", timestamp(asset.updatedAt)],
                ["현재 행 수", num(asset.rows)],
                ["데이터 오너", asset.owner],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <h4>실제 DB 컬럼</h4>
            <div className="chips">
              {asset.columns.map((c) => (
                <span key={c.name}>
                  {c.name}
                  {c.pk ? " · PK" : ""}
                  {c.type ? ` (${c.type})` : ""}
                </span>
              ))}
            </div>
            <h4>상류 자산 {up.length}개</h4>
            <div className="chips">
              {up.map((id) => (
                <button key={id} onClick={() => setSelected(id)}>
                  {id}
                </button>
              ))}
              {!up.length && <span>상류 SQL 의존 관계 없음</span>}
            </div>
            <h4>하류 자산 {down.length}개</h4>
            <div className="chips">
              {down.map((id) => (
                <button key={id} onClick={() => setSelected(id)}>
                  {id}
                </button>
              ))}
              {!down.length && <span>하류 SQL 의존 관계 없음</span>}
            </div>
            <div className="impact-note">
              <ShieldCheck size={18} />
              <span>
                스키마 변경 시 하류 뷰 {down.length}개의 영향 검토가 필요합니다.
                API 코드의 직접 조회 관계는 이 그래프에 포함하지 않습니다.
              </span>
            </div>
          </div>
        </aside>
      </div>
      <Panel title="샘플 데이터 적재 이력" className="pipeline-panel">
        <DataTable
          headers={["작업", "상태", "처리 행 수", "실행 시각 (KST)"]}
          rows={data.pipelines.map((p) => [
            p.name,
            p.status === "success" ? "성공" : p.status,
            num(p.processed_rows),
            timestamp(p.finished_at),
          ])}
        />
      </Panel>
    </div>
  );
}
export function SettingsPage({
  bootstrap,
  onSave,
}: {
  bootstrap: Bootstrap;
  onSave: (s: Settings) => void;
}) {
  const [name, setName] = useState(bootstrap.settings.workspaceName),
    [alerts, setAlerts] = useState(bootstrap.settings.alertsEnabled),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="settings-grid">
      <Panel title="워크스페이스 설정">
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError("");
            try {
              const s = await request<Settings>("/api/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  workspaceName: name,
                  alertsEnabled: alerts,
                }),
              });
              onSave(s);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            워크스페이스 이름
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
            />
          </label>
          <label>
            표준 시간대
            <input value="Asia/Seoul (KST, UTC+9)" readOnly />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={alerts}
              onChange={(e) => setAlerts(e.target.checked)}
            />{" "}
            적재 상태 알림 표시
          </label>
          {error && (
            <p className="danger" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={saving}>
            {saving ? "저장 중…" : "DB에 설정 저장"}
          </button>
          <p className="muted">
            설정은 PostgreSQL DB에 저장되어 브라우저와 서버를 다시 실행해도
            유지됩니다.
          </p>
        </form>
      </Panel>
      <Panel title="DB 연결 및 데이터 범위">
        <div className="settings-info">
          <h3>PostgreSQL · 샘플 데이터베이스</h3>
          <p>
            샘플 데이터 범위
            <br />
            {bootstrap.seed.start_date} ~ {bootstrap.seed.end_date}
          </p>
          <p>
            최초 생성: {timestamp(bootstrap.seed.created_at)} KST
            <br />
            데이터 버전: {bootstrap.seed.version}
          </p>
          <p>
            최초 실행 시 DB를 자동 생성합니다. 이후 같은 DB를 계속 조회하며 새로
            실행해도 데이터가 초기화되지 않습니다.
          </p>
          <p>
            이 프로토타입의 고객과 거래는 모두 생성한 샘플입니다. 실제
            현대백화점 데이터와 로그인 인증은 연결하지 않았습니다.
          </p>
        </div>
      </Panel>
    </div>
  );
}
