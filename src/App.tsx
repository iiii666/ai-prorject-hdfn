import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  ChartNoAxesCombined,
  Sparkles,
  Smartphone,
  Wallet,
  Network,
  Database,
  Settings,
  ArrowUpRight,
  ArrowDownToLine,
  ChevronRight,
  Menu,
  X,
  Search,
  ArrowRight,
  RefreshCw,
  CircleHelp,
  Bell,
  Check,
  SlidersHorizontal,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import {
  pageNames,
  defaultFilters,
  scale,
  makeTrend,
  campaigns,
  assets,
  edges,
  related,
} from "./data";
import type { Page, Filters } from "./data";
const icons = {
  overview: LayoutDashboard,
  customers: Users,
  sales: ChartNoAxesCombined,
  campaigns: Sparkles,
  app: Smartphone,
  budget: Wallet,
  catalog: Database,
  lineage: Network,
  settings: Settings,
};
const format = (v: number) => Math.round(v).toLocaleString("ko-KR");
const getPage = (): Page => {
  const p = location.hash.slice(1);
  return p in pageNames ? (p as Page) : "overview";
};
function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
function Progress({ value, warm = false }: { value: number; warm?: boolean }) {
  return (
    <div className={`progress ${warm ? "warm" : ""}`}>
      <span style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}
function Kpi({
  label,
  value,
  unit,
  change,
  warning = false,
  index = 0,
}: {
  label: string;
  value: string;
  unit?: string;
  change: string;
  warning?: boolean;
  index?: number;
}) {
  const Icon = [ChartNoAxesCombined, Users, Sparkles, Wallet][index];
  return (
    <article className="kpi">
      <div className="kpi-label">
        {label}
        <Icon size={16} />
      </div>
      <div className="kpi-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className={`kpi-change ${warning ? "danger" : ""}`}>▲ {change}</div>
    </article>
  );
}
function Trend({ filters, bar = false }: { filters: Filters; bar?: boolean }) {
  const data = makeTrend(filters);
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        {bar ? (
          <BarChart data={data.filter((_, i) => i % 3 === 0)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(v) => [`${format(Number(v))}명`, "활성 사용자"]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="current"
              fill="#5585f6"
              radius={[5, 5, 0, 0]}
            />
          </BarChart>
        ) : (
          <AreaChart
            data={data}
            margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
          >
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4d7ff6" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#4d7ff6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#edf0f6" />
            <XAxis
              dataKey="day"
              minTickGap={65}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(1)}천`}
            />
            <Tooltip
              formatter={(v, n) => [
                `${format(Number(v))}만 원`,
                n === "current" ? "매출" : "전기 매출",
              ]}
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="previous"
              stroke="#a5baff"
              strokeDasharray="5 5"
              fill="none"
            />
            <Area
              isAnimationActive={false}
              type="monotone"
              dataKey="current"
              stroke="#4f80ff"
              strokeWidth={2.5}
              fill="url(#salesFill)"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
function CampaignTable({
  filters,
  full = false,
  onSelect,
}: {
  filters: Filters;
  full?: boolean;
  onSelect: (name: string) => void;
}) {
  const list = campaigns
    .filter(
      (c) => filters.channel === "전체 채널" || c.channel === filters.channel,
    )
    .slice(0, full ? 10 : 3);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>캠페인</th>
            <th>대상</th>
            <th>전환율</th>
            <th>집행률</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.name}>
              <td>
                <button
                  className="text-button"
                  onClick={() => onSelect(c.name)}
                >
                  {c.name}
                </button>
              </td>
              <td>{format(c.target * scale(filters))}명</td>
              <td>{c.conversion}%</td>
              <td>
                <div className="inline-progress">
                  <Progress value={c.progress} />
                  <span>{c.progress}%</span>
                </div>
              </td>
              <td>
                <span
                  className={`status ${c.status === "완료" ? "muted" : ""}`}
                >
                  {c.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Insights({ filters, onAsk }: { filters: Filters; onAsk: () => void }) {
  return (
    <Panel
      title="✦ AI 인사이트"
      className="insights"
      aside={<span className="purple-tag">예시 요약</span>}
    >
      <div className="insight-body">
        <div>
          <h3>매출 상승을 이끈 요인</h3>
          <p>
            최근 {filters.days}일 매출은 전기보다 12.8% 증가했습니다. 모바일
            채널과 재구매 고객의 기여가 가장 컸습니다.
          </p>
        </div>
        <div>
          <h3>확인할 캠페인</h3>
          <p>
            ‘가을 재방문 쿠폰’ 전환율이 평균보다 높습니다. 예산 소진 속도도 함께
            확인해 보세요.
          </p>
        </div>
        <div>
          <h3>예산 집행 주의</h3>
          <p>
            마케팅 예산이 계획보다 빠르게 집행 중입니다. 현재 추세가 이어지면
            월말 예산을 초과할 수 있습니다.
          </p>
        </div>
        <button className="outline purple" onClick={onAsk}>
          지표 해설 보기 <ArrowRight size={14} />
        </button>
      </div>
    </Panel>
  );
}
function BudgetSummary({ filters }: { filters: Filters }) {
  const s = scale(filters);
  return (
    <div className="budget-summary">
      <div className="budget-label">
        <span>마케팅 예산</span>
        <strong>
          ₩ {(2.9 * s).toFixed(2)}억 <em>/ ₩ {(4 * s).toFixed(2)}억</em>
        </strong>
      </div>
      <Progress value={72.4} />
      <div className="budget-label">
        <span>매출 목표 달성</span>
        <strong>
          ₩ {(8.42 * s).toFixed(2)}억 <em>/ ₩ {(10 * s).toFixed(2)}억</em>
        </strong>
      </div>
      <Progress value={84.2} warm />
      <div className="mini-stats">
        <div>
          <span>앱 월간 활성 사용자</span>
          <strong>
            {format(86240 * s)}
            <small>명</small>
          </strong>
        </div>
        <div>
          <span>데이터 갱신 상태</span>
          <strong className="status">
            ● 정상 <small>09:42 기준 · 샘플</small>
          </strong>
        </div>
      </div>
    </div>
  );
}
function Customers({ filters }: { filters: Filters }) {
  const s = scale(filters);
  return (
    <>
      <div className="kpi-grid">
        <Kpi
          label="전체 고객"
          value={format(248610 * s)}
          change="3.8% 전기 대비"
        />
        <Kpi
          label="신규 고객"
          value={format(12480 * s)}
          change="8.2% 전기 대비"
          index={1}
        />
        <Kpi
          label="재구매율"
          value="34.6"
          unit="%"
          change="1.4%p 전기 대비"
          index={2}
        />
        <Kpi
          label="휴면 전환 위험"
          value={format(6284 * s)}
          change="최근 30일 미방문"
          warning
          index={3}
        />
      </div>
      <div className="customer-grid">
        <Panel
          title="고객 등급 구성"
          aside={<span className="muted">전체 고객 기준</span>}
        >
          <div className="grade-list">
            {[
              ["일반", 54],
              ["실버", 26],
              ["골드", 14],
              ["VIP", 6],
            ].map(([name, v]) => (
              <div className="grade" key={name}>
                <span>{name}</span>
                <Progress value={Number(v)} />
                <strong>{v}%</strong>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="✦ AI 고객 인사이트"
          className="insights"
          aside={<span className="purple-tag">예시 요약</span>}
        >
          <div className="insight-body">
            <h3>신규 고객 유입이 8.2% 증가</h3>
            <p>
              첫 구매 후 14일 내 재방문이 낮은 고객에게 웰컴 쿠폰을 제안해
              보세요. VIP 고객은 전체의 6%로 높은 매출 기여를 보입니다.
            </p>
          </div>
        </Panel>
      </div>
      <Panel title="고객 세그먼트">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>고객군</th>
                <th>고객 수</th>
                <th>매출 기여</th>
                <th>평균 구매액</th>
                <th>전기 대비</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>VIP 우수 고객</td>
                <td>{format(14917 * s)}</td>
                <td>38.4%</td>
                <td>₩ 184,200</td>
                <td className="status">▲ 4.8%</td>
              </tr>
              <tr>
                <td>신규 첫 구매</td>
                <td>{format(12480 * s)}</td>
                <td>9.2%</td>
                <td>₩ 62,400</td>
                <td className="status">▲ 8.2%</td>
              </tr>
              <tr>
                <td>휴면 위험 고객</td>
                <td>{format(6284 * s)}</td>
                <td>—</td>
                <td>최근 30일 미구매</td>
                <td className="danger">주의</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
function Lineage({ initial }: { initial: string }) {
  const [selected, setSelected] = useState(initial);
  const [direction, setDirection] = useState("all");
  const [domain, setDomain] = useState("all");
  const asset = assets.find((a) => a.id === selected)!;
  const up = related(selected, "up"),
    down = related(selected, "down");
  const visible = assets.filter(
    (a) =>
      (domain === "all" ||
        ["SOURCE", "INGEST", "WAREHOUSE"].includes(a.type) ||
        a.id.includes(domain)) &&
      (direction === "all" ||
        a.id === selected ||
        (direction === "up" ? up : down).includes(a.id)),
  );
  const ids = visible.map((a) => a.id);
  return (
    <div className="lineage-page">
      <div className="lineage-kpis">
        {[
          ["추적 중인 자산", `${assets.length}`, "원천부터 리포트까지"],
          ["데이터 파이프라인", "4", "모두 정상 · 샘플 상태"],
          ["최종 갱신", "09:42", "예시 시각 · KST"],
          ["영향 받는 자산", `${down.length}`, "선택 자산 기준"],
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
              <p>노드를 선택하여 상·하류 관계와 영향 범위를 확인하세요.</p>
            </div>
            <div className="flow-filters">
              <select
                aria-label="리니지 도메인"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              >
                <option value="all">전체 도메인</option>
                <option value="sales">매출</option>
                <option value="customer">고객</option>
              </select>
              <select
                aria-label="리니지 방향"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="all">상·하류 모두</option>
                <option value="up">상류만</option>
                <option value="down">하류만</option>
              </select>
            </div>
          </div>
          <div className="flow-scroll">
            <div className="flow-canvas">
              <div className="flow-columns">
                {[
                  "SOURCE",
                  "INGEST",
                  "WAREHOUSE",
                  "DATA MART",
                  "CONSUMPTION",
                ].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              <svg
                className="connections"
                width="1080"
                height="510"
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
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#35c4bd" />
                  </marker>
                </defs>
                {edges
                  .filter(
                    ([from, to]) => ids.includes(from) && ids.includes(to),
                  )
                  .map(([from, to]) => {
                    const a = assets.find((v) => v.id === from)!,
                      b = assets.find((v) => v.id === to)!;
                    const active =
                      from === selected ||
                      to === selected ||
                      (up.includes(from) && up.includes(to)) ||
                      (down.includes(from) && down.includes(to));
                    return (
                      <path
                        key={from + to}
                        d={`M ${a.x + 172} ${a.y + 53} C ${a.x + 210} ${a.y + 53}, ${b.x - 35} ${b.y + 53}, ${b.x} ${b.y + 53}`}
                        fill="none"
                        stroke={active ? "#35c4bd" : "#2d4561"}
                        strokeWidth={active ? 2.5 : 1.5}
                        markerEnd={active ? "url(#arrow)" : undefined}
                      />
                    );
                  })}
              </svg>
              {visible.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={`flow-node ${a.id === selected ? "selected" : ""} ${up.includes(a.id) || down.includes(a.id) ? "related" : ""}`}
                  style={{ left: a.x, top: a.y }}
                >
                  <small
                    className={`engine ${a.type.toLowerCase().replace(" ", "-")}`}
                  >
                    {a.engine}
                  </small>
                  <strong>{a.name}</strong>
                  <span>{a.description}</span>
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
                ["상태", "● 정상"],
                ["마지막 갱신", "샘플 09:42"],
                ["행 수", asset.rows],
                ["데이터 오너", asset.owner],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <h4>주요 컬럼</h4>
            <div className="chips">
              {asset.columns.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <h4>상류 자산 {up.length}개</h4>
            <div className="chips">
              {up.length ? (
                up.map((id) => (
                  <button key={id} onClick={() => setSelected(id)}>
                    {id}
                  </button>
                ))
              ) : (
                <span>원천 자산입니다</span>
              )}
            </div>
            <h4>하류 자산 {down.length}개</h4>
            <div className="chips">
              {down.length ? (
                down.map((id) => (
                  <button key={id} onClick={() => setSelected(id)}>
                    {id}
                  </button>
                ))
              ) : (
                <span>최종 소비 자산입니다</span>
              )}
            </div>
            <div className="impact-note">
              <ShieldCheck size={18} />
              <span>
                스키마 변경 시 하류 자산 {down.length}개의 영향 검토가
                필요합니다.
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
function Catalog({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const list = assets.filter(
    (a) =>
      (type === "all" || a.type === type) &&
      `${a.name} ${a.description} ${a.owner}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <Panel
      title="데이터 자산"
      aside={<span className="muted">{list.length}개 자산</span>}
    >
      <div className="catalog-tools">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="데이터 자산 검색"
            placeholder="테이블명, 설명, 오너 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="자산 유형"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">전체 유형</option>
          {[...new Set(assets.map((a) => a.type))].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>자산명</th>
              <th>유형</th>
              <th>설명</th>
              <th>오너</th>
              <th>리니지</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.name}</strong>
                </td>
                <td>
                  <span className="type-tag">{a.type}</span>
                </td>
                <td>{a.description}</td>
                <td>{a.owner}</td>
                <td>
                  <button
                    className="text-button blue"
                    onClick={() => onOpen(a.id)}
                  >
                    흐름 보기 →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <div className="empty">검색 조건에 맞는 자산이 없습니다.</div>
        )}
      </div>
    </Panel>
  );
}
function SettingsPage({ notify }: { notify: (s: string) => void }) {
  const [name, setName] = useState(
    () => localStorage.getItem("dw-workspace") || "현대백화점 DW",
  );
  const [alerts, setAlerts] = useState(
    () => localStorage.getItem("dw-alerts") !== "false",
  );
  return (
    <div className="settings-grid">
      <Panel title="워크스페이스 설정">
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            localStorage.setItem("dw-workspace", name);
            localStorage.setItem("dw-alerts", String(alerts));
            notify("이 브라우저에 설정을 저장했습니다.");
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
            데이터 품질 알림 표시 (데모 설정)
          </label>
          <button className="primary" type="submit">
            설정 저장
          </button>
        </form>
      </Panel>
      <Panel title="데이터 연결 상태">
        <div className="settings-info">
          <Database size={30} />
          <h3>샘플 데이터 모드</h3>
          <p>
            현재 화면은 샘플 데이터로 실행됩니다. 실제 DW·인증·AI API는 아직
            연결되지 않았습니다.
          </p>
          <p>
            실서비스 연결 시 별도 백엔드에서 인증과 데이터 조회를 처리해야
            합니다.
          </p>
        </div>
      </Panel>
    </div>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>(getPage);
  const [mobile, setMobile] = useState(false);
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [asset, setAsset] = useState("payment_events");
  const s = scale(filters);
  const navigate = (p: Page) => {
    location.hash = p;
    setPage(p);
    setMobile(false);
  };
  useEffect(() => {
    const handle = () => setPage(getPage());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  useEffect(() => {
    document.title = `${pageNames[page]} | 현대백화점 DW`;
  }, [page]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!dialog) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", close);
    const before = document.activeElement as HTMLElement | null;
    const btn = document.querySelector<HTMLButtonElement>(".dialog-close");
    btn?.focus();
    return () => {
      window.removeEventListener("keydown", close);
      before?.focus();
    };
  }, [dialog]);
  const campaignDetail = (name: string) => {
    const c = campaigns.find((c) => c.name === name)!;
    setDialog({
      title: name,
      body: `대상 고객 ${format(c.target * s)}명 · 전환율 ${c.conversion}% · 집행률 ${c.progress}%\n채널: ${c.channel} / 상태: ${c.status}\n\n샘플 캠페인입니다. 실제 발송·집행 기능은 DW 및 캠페인 시스템 연결 후 사용할 수 있습니다.`,
    });
  };
  const exportCsv = () => {
    const rows = [
      ["항목", "값", "기간", "점포", "채널"],
      [
        "총 매출(억원)",
        (8.42 * s).toFixed(2),
        filters.days,
        filters.store,
        filters.channel,
      ],
      [
        "활성 고객",
        String(Math.round(124830 * s)),
        filters.days,
        filters.store,
        filters.channel,
      ],
      ["캠페인 전환율", "6.84%", filters.days, filters.store, filters.channel],
      ["데이터 구분", "샘플 데이터", "", "", ""],
    ];
    const blob = new Blob(
      ["\uFEFF" + rows.map((r) => r.join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8;" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hyundai-dw-summary.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("현재 필터의 요약 CSV를 다운로드했습니다.");
  };
  const descriptions: Record<Page, string> = {
    overview: "고객, 매출, 캠페인, 앱 이용과 예산 실적을 한눈에 확인합니다.",
    customers: "고객 규모와 등급·유입·재구매 현황을 확인합니다.",
    sales: "점포와 채널별 매출 흐름 및 목표 달성 현황을 살펴봅니다.",
    campaigns: "고객에게 닿는 캠페인, 성과를 데이터로 확인합니다.",
    app: "앱 방문부터 구매까지 고객의 디지털 여정을 확인합니다.",
    budget: "계획과 실적을 비교하고 예산 집행 속도를 관리합니다.",
    catalog: "신뢰할 수 있는 데이터 자산을 찾고 활용하세요.",
    lineage: "원천부터 BI 리포트까지 데이터 흐름과 영향 범위를 추적합니다.",
    settings: "워크스페이스 환경과 데이터 연결 정보를 관리합니다.",
  };
  return (
    <div className={`app-shell ${page === "lineage" ? "dark-mode" : ""}`}>
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          href="#overview"
          className="brand"
          onClick={() => navigate("overview")}
        >
          <span className="brand-mark">
            H<span>·</span>
          </span>
          <span>
            현대백화점 <b>DW</b>
            <small>DATA WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE · 본사 분석</div>
        <nav aria-label="주 메뉴">
          {(
            [
              "overview",
              "customers",
              "sales",
              "campaigns",
              "app",
              "budget",
              "catalog",
              "lineage",
              "settings",
            ] as Page[]
          ).map((p, i) => {
            const Icon = icons[p];
            return (
              <div key={p}>
                {i === 1 && <div className="nav-label">비즈니스 분석</div>}
                {i === 6 && <div className="nav-label">데이터 관리</div>}
                <button
                  className={`nav-item ${page === p ? "active" : ""}`}
                  onClick={() => navigate(p)}
                  aria-current={page === p ? "page" : undefined}
                >
                  <Icon size={18} />
                  <span>{pageNames[p]}</span>
                  {page === p && <span className="active-dot" />}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sample-label">
            <span />
            샘플 데이터 워크스페이스
          </div>
          <p>
            데이터 기준 시각
            <br />
            <strong>예시 09:42 KST</strong>
          </p>
          <button
            className="help-button"
            onClick={() =>
              setDialog({
                title: "현대백화점 DW 사용 안내",
                body: "왼쪽 메뉴에서 분석 화면을 선택하세요. 기간·점포·채널을 고른 뒤 조건 적용을 누르면 샘플 집계가 바뀝니다.\n\n카탈로그에서 데이터 자산을 검색하고, 리니지에서 노드를 선택해 영향 범위를 확인할 수 있습니다.\n\n현재 데이터와 AI 인사이트는 모두 데모용 예시입니다.",
              })
            }
          >
            <CircleHelp size={16} /> 워크스페이스 도움말
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Analytics</span>
            <ChevronRight size={13} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <span />
              샘플 데이터
            </span>
            <button
              className="icon-button notification"
              aria-label="알림 보기"
              onClick={() =>
                setDialog({
                  title: "데이터 알림",
                  body: "샘플 파이프라인 4개가 정상 상태입니다.\n데모 데이터 기준 시각은 09:42 KST입니다.\n\n실시간 모니터링과 알림은 아직 연결되지 않았습니다.",
                })
              }
            >
              <Bell size={17} />
              <i />
            </button>
            <span className="user-name">데모 관리자</span>
            <span className="avatar">현</span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">HYUNDAI DEPARTMENT STORE</div>
              <h1>
                {page === "overview"
                  ? "통합 비즈니스 현황"
                  : page === "lineage"
                    ? "매출 분석 데이터 리니지"
                    : pageNames[page]}
              </h1>
              <p>{descriptions[page]}</p>
            </div>
            {!["lineage", "catalog", "settings"].includes(page) && (
              <div className="filters">
                <select
                  aria-label="조회 기간"
                  value={draft.days}
                  onChange={(e) => setDraft({ ...draft, days: e.target.value })}
                >
                  <option value="7">최근 7일</option>
                  <option value="30">최근 30일</option>
                  <option value="90">최근 90일</option>
                </select>
                <select
                  aria-label="점포"
                  value={draft.store}
                  onChange={(e) =>
                    setDraft({ ...draft, store: e.target.value })
                  }
                >
                  {["전체 점포", "더현대 서울", "압구정본점", "판교점"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
                <select
                  aria-label="채널"
                  value={draft.channel}
                  onChange={(e) =>
                    setDraft({ ...draft, channel: e.target.value })
                  }
                >
                  {["전체 채널", "모바일 앱", "오프라인"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
                <button
                  className="primary"
                  onClick={() => {
                    setFilters({ ...draft });
                    setToast("조회 조건을 적용했습니다.");
                  }}
                >
                  <SlidersHorizontal size={14} />
                  조건 적용
                </button>
              </div>
            )}
          </div>
          {!["lineage", "catalog", "settings"].includes(page) && (
            <div className="view-meta">
              <span>
                <Clock3 size={13} /> 최근 {filters.days}일 <i /> {filters.store}{" "}
                <i /> {filters.channel}
              </span>
              <button className="text-button" onClick={exportCsv}>
                <ArrowDownToLine size={14} /> 요약 다운로드
              </button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="kpi-grid">
                <Kpi
                  label="총 매출"
                  value={`₩ ${(8.42 * s).toFixed(2)}`}
                  unit="억"
                  change="12.8% 전기 대비"
                />
                <Kpi
                  label="활성 고객"
                  value={format(124830 * s)}
                  change="4.2% 전기 대비"
                  index={1}
                />
                <Kpi
                  label="캠페인 전환율"
                  value="6.84"
                  unit="%"
                  change="0.6%p 전기 대비"
                  index={2}
                />
                <Kpi
                  label="예산 집행률"
                  value="72.4"
                  unit="%"
                  change="8.1%p 계획 대비 빠른 집행"
                  index={3}
                  warning
                />
              </div>
              <div className="overview-middle">
                <Panel
                  title="매출 및 주문 추이"
                  aside={
                    <span className="muted">최근 {filters.days}일 · 일별</span>
                  }
                >
                  <div className="legend">
                    <span>
                      <i />
                      매출
                    </span>
                    <span>
                      <i />
                      전기 매출
                    </span>
                  </div>
                  <Trend filters={filters} />
                  <div className="chart-summary">
                    <span>
                      매출은 전기 대비 <strong>12.8% 증가</strong>했습니다.
                    </span>
                    <button
                      className="text-button blue"
                      onClick={() => navigate("sales")}
                    >
                      매출 분석 보기 <ArrowUpRight size={14} />
                    </button>
                  </div>
                </Panel>
                <Insights
                  filters={filters}
                  onAsk={() =>
                    setDialog({
                      title: "지표 해설 · 샘플",
                      body: "매출: 선택 기간 내 주문 금액 합계\n활성 고객: 기간 내 구매 이력이 있는 고유 고객\n캠페인 전환율: 캠페인 대상 중 구매 고객 비율\n예산 집행률: 집행 금액 / 배정 예산\n\n화면의 수치 및 인사이트는 예시이며 실제 DW 정의와 연결되지 않았습니다.",
                    })
                  }
                />
              </div>
              <div className="overview-bottom">
                <Panel
                  title="캠페인 성과"
                  aside={
                    <button
                      className="text-button blue"
                      onClick={() => navigate("campaigns")}
                    >
                      전체 보기 <ArrowRight size={13} />
                    </button>
                  }
                >
                  <CampaignTable filters={filters} onSelect={campaignDetail} />
                </Panel>
                <Panel
                  title="예산 대비 실적"
                  aside={<span className="muted">선택 기간 누계</span>}
                >
                  <BudgetSummary filters={filters} />
                </Panel>
              </div>
            </>
          )}
          {page === "customers" && <Customers filters={filters} />}
          {page === "sales" && (
            <>
              <div className="kpi-grid">
                <Kpi
                  label="총 매출"
                  value={`₩ ${(8.42 * s).toFixed(2)}`}
                  unit="억"
                  change="12.8% 전기 대비"
                />
                <Kpi
                  label="주문 수"
                  value={format(16483 * s)}
                  unit="건"
                  change="7.2% 전기 대비"
                  index={1}
                />
                <Kpi
                  label="평균 주문 금액"
                  value="₩ 51,083"
                  change="5.2% 전기 대비"
                  index={2}
                />
                <Kpi
                  label="목표 달성률"
                  value="84.2"
                  unit="%"
                  change="6.4%p 전기 대비"
                  index={3}
                />
              </div>
              <Panel
                title="일별 매출 추이"
                aside={<span className="muted">단위: 만 원</span>}
              >
                <div className="legend">
                  <span>
                    <i />
                    매출
                  </span>
                  <span>
                    <i />
                    전기 매출
                  </span>
                </div>
                <Trend filters={filters} />
              </Panel>
              <Panel title="상품군별 매출">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>상품군</th>
                        <th>매출액</th>
                        <th>매출 비중</th>
                        <th>전기 대비</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["패션", 36, 14.2],
                        ["식품", 27, 9.8],
                        ["리빙", 22, 11.3],
                        ["뷰티", 15, 18.1],
                      ].map(([n, v, c]) => (
                        <tr key={n}>
                          <td>{n}</td>
                          <td>
                            ₩ {((8.42 * s * Number(v)) / 100).toFixed(2)}억
                          </td>
                          <td>
                            <div className="inline-progress">
                              <Progress value={Number(v)} />
                              {v}%
                            </div>
                          </td>
                          <td className="status">▲ {c}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {page === "campaigns" && (
            <>
              <div className="kpi-grid">
                <Kpi
                  label="등록 캠페인"
                  value="5"
                  unit="개"
                  change="진행 중 4개"
                />
                <Kpi
                  label="대상 고객"
                  value={format(
                    campaigns
                      .filter(
                        (c) =>
                          filters.channel === "전체 채널" ||
                          c.channel === filters.channel,
                      )
                      .reduce((a, c) => a + c.target, 0) * s,
                  )}
                  change="중복 포함"
                  index={1}
                />
                <Kpi
                  label="평균 전환율"
                  value={(
                    campaigns
                      .filter(
                        (c) =>
                          filters.channel === "전체 채널" ||
                          c.channel === filters.channel,
                      )
                      .reduce((a, c) => a + c.conversion, 0) /
                    campaigns.filter(
                      (c) =>
                        filters.channel === "전체 채널" ||
                        c.channel === filters.channel,
                    ).length
                  ).toFixed(2)}
                  unit="%"
                  change="선택 채널 캠페인 단순 평균"
                  index={2}
                />
                <Kpi
                  label="완료 캠페인"
                  value="1"
                  unit="개"
                  change="VIP 프라이빗 초대"
                  index={3}
                />
              </div>
              <Panel
                title="캠페인별 성과"
                aside={
                  <span className="muted">캠페인명을 누르면 상세 확인</span>
                }
              >
                <CampaignTable
                  filters={filters}
                  full
                  onSelect={campaignDetail}
                />
              </Panel>
            </>
          )}
          {page === "app" && (
            <>
              <div className="kpi-grid">
                <Kpi
                  label="월간 활성 사용자"
                  value={format(86240 * s)}
                  change="5.1% 전기 대비"
                />
                <Kpi
                  label="일 평균 방문"
                  value={format((18240 * s * 30) / Number(filters.days))}
                  change="3.4% 전기 대비"
                  index={1}
                />
                <Kpi
                  label="구매 전환율"
                  value="4.82"
                  unit="%"
                  change="0.3%p 전기 대비"
                  index={2}
                />
                <Kpi
                  label="평균 이용 시간"
                  value="6분 24초"
                  change="18초 전기 대비"
                  index={3}
                />
              </div>
              <Panel title="일별 활성 사용자">
                <Trend filters={filters} bar />
              </Panel>
              <Panel title="구매 전환 퍼널">
                <div className="funnel">
                  {[
                    ["앱 방문", 100],
                    ["상품 조회", 72],
                    ["장바구니", 24],
                    ["구매 완료", 4.82],
                  ].map(([n, v]) => (
                    <div key={n}>
                      <span>{n}</span>
                      <Progress value={Number(v)} />
                      <strong>{v}%</strong>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
          {page === "budget" && (
            <>
              <div className="kpi-grid">
                <Kpi
                  label="총 배정 예산"
                  value={`₩ ${(4 * s).toFixed(2)}`}
                  unit="억"
                  change="선택 기간 기준"
                />
                <Kpi
                  label="집행 금액"
                  value={`₩ ${(2.9 * s).toFixed(2)}`}
                  unit="억"
                  change="72.4% 집행"
                  index={1}
                />
                <Kpi
                  label="매출 목표"
                  value={`₩ ${(10 * s).toFixed(2)}`}
                  unit="억"
                  change="84.2% 달성"
                  index={2}
                />
                <Kpi
                  label="잔여 예산"
                  value={`₩ ${(1.1 * s).toFixed(2)}`}
                  unit="억"
                  change="27.6% 잔여"
                  index={3}
                />
              </div>
              <Panel title="예산 대비 실적">
                <BudgetSummary filters={filters} />
              </Panel>
              <Panel title="부문별 예산 집행">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>부문</th>
                        <th>배정 예산</th>
                        <th>집행 금액</th>
                        <th>집행률</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["디지털 마케팅", 1.8, 1.42],
                        ["CRM 캠페인", 1.4, 0.96],
                        ["오프라인 프로모션", 0.8, 0.52],
                      ].map(([n, a, b]) => (
                        <tr key={n}>
                          <td>{n}</td>
                          <td>₩ {(Number(a) * s).toFixed(2)}억</td>
                          <td>₩ {(Number(b) * s).toFixed(2)}억</td>
                          <td>{((Number(b) / Number(a)) * 100).toFixed(1)}%</td>
                          <td
                            className={
                              Number(b) / Number(a) > 0.75 ? "danger" : "status"
                            }
                          >
                            {Number(b) / Number(a) > 0.75
                              ? "집행 속도 주의"
                              : "정상"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}
          {page === "catalog" && (
            <Catalog
              onOpen={(id) => {
                setAsset(id);
                navigate("lineage");
              }}
            />
          )}
          {page === "lineage" && <Lineage key={asset} initial={asset} />}
          {page === "settings" && <SettingsPage notify={setToast} />}
          <footer>
            <span>
              <span className="footer-dot" />
              DEMO WORKSPACE
            </span>
            <p>
              표시 데이터와 AI 요약은 화면 구성 예시입니다. 실제 DW·인증·AI
              서비스는 연결 전입니다.
            </p>
            <button
              className="text-button"
              onClick={() => {
                setFilters(defaultFilters);
                setDraft(defaultFilters);
                setToast("조회 조건을 초기화했습니다.");
              }}
            >
              <RefreshCw size={12} /> 조건 초기화
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                document
                  .querySelector<HTMLButtonElement>(".dialog-close")
                  ?.focus();
              }
            }}
          >
            <button
              className="icon-button dialog-close"
              aria-label="닫기"
              onClick={() => setDialog(null)}
            >
              <X size={20} />
            </button>
            <span className="dialog-icon">
              <Sparkles size={24} />
            </span>
            <h2 id="dialog-title">{dialog.title}</h2>
            <p>{dialog.body}</p>
          </section>
        </div>
      )}
    </div>
  );
}
