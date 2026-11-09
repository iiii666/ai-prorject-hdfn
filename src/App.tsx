import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  ChartNoAxesCombined,
  Sparkles,
  Smartphone,
  Wallet,
  Database,
  Network,
  Settings as SettingsIcon,
  Menu,
  X,
  Bell,
  ChevronRight,
  RefreshCw,
  ArrowDownToLine,
  CircleHelp,
  Check,
} from "lucide-react";
import { pageNames, dateAdd } from "./data";
import type { Page, Filters } from "./data";
import { request, useApi } from "./api";
import type { Bootstrap, Analytics, Catalog, Campaign } from "./api";
import AnalysisPages from "./AnalysisPages";
import { CatalogPage, LineagePage, SettingsPage } from "./DataManagement";
import { num, money, pct, timestamp } from "./components";
const icons = {
  overview: LayoutDashboard,
  customers: Users,
  sales: ChartNoAxesCombined,
  campaigns: Sparkles,
  app: Smartphone,
  budget: Wallet,
  catalog: Database,
  lineage: Network,
  settings: SettingsIcon,
};
const getPage = (): Page =>
  Object.hasOwn(pageNames, location.hash.slice(1))
    ? (location.hash.slice(1) as Page)
    : "overview";
const descriptions: Record<Page, string> = {
  overview:
    "DB에 저장된 고객, 매출, 캠페인, 앱 이용과 예산을 한눈에 조회합니다.",
  customers: "주문 이력으로 고객 규모와 등급·유입·재구매 현황을 분석합니다.",
  sales: "실제 저장된 주문과 결제를 점포·기간·채널별로 조회합니다.",
  campaigns: "캠페인 대상 고객과 구매 전환, 집행 내역을 확인합니다.",
  app: "앱 세션을 바탕으로 방문부터 구매까지 이용 흐름을 확인합니다.",
  budget: "부문별 배정 예산, 집행 내역과 매출 목표를 비교합니다.",
  catalog: "SQLite 테이블과 SQL 뷰의 스키마·행 수를 조회합니다.",
  lineage: "실제 SQL 뷰의 데이터 흐름과 영향 범위를 확인합니다.",
  settings: "DB에 저장되는 워크스페이스 설정과 데이터 정보를 관리합니다.",
};
function Dialog({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => before?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            e.preventDefault();
            ref.current?.focus();
          }
        }}
      >
        <button
          ref={ref}
          className="icon-button dialog-close"
          aria-label="닫기"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="dialog-icon">
          <Database size={24} />
        </span>
        <h2 id="dialog-title">{title}</h2>
        <p>{body}</p>
      </section>
    </div>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>(getPage),
    [mobile, setMobile] = useState(false),
    [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [startupError, setStartupError] = useState(""),
    [draft, setDraft] = useState<Filters | null>(null),
    [filters, setFilters] = useState<Filters | null>(null),
    [period, setPeriod] = useState("30"),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState(""),
    [dialog, setDialog] = useState<{ title: string; body: string } | null>(
      null,
    ),
    [selectedAsset, setSelectedAsset] = useState("dw_fact_orders"),
    [exporting, setExporting] = useState(false);
  const query = filters ? new URLSearchParams(filters).toString() : "";
  const analysis = useApi<Analytics>(
    filters ? `/api/analytics?${query}` : null,
    revision,
  );
  const catalog = useApi<Catalog>(bootstrap ? "/api/catalog" : null, revision);
  const analyticPage = !["catalog", "lineage", "settings"].includes(page);
  useEffect(() => {
    const controller = new AbortController();
    request<Bootstrap>("/api/bootstrap", { signal: controller.signal })
      .then((b) => {
        setBootstrap(b);
        const f = {
          start: dateAdd(b.seed.end_date, -29),
          end: b.seed.end_date,
          store: "",
          channel: "",
        };
        setDraft(f);
        setFilters(f);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setStartupError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const listener = () => {
      setPage(getPage());
      setMobile(false);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    document.title = `${pageNames[page]} | ${bootstrap?.settings.workspaceName || "현대백화점 DW"}`;
  }, [page, bootstrap]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (p: Page) => {
    setPage(p);
    location.hash = p;
    setMobile(false);
  };
  const reset = () => {
    if (!bootstrap) return;
    const f = {
      start: dateAdd(bootstrap.seed.end_date, -29),
      end: bootstrap.seed.end_date,
      store: "",
      channel: "",
    };
    setDraft(f);
    setFilters(f);
    setPeriod("30");
  };
  const campaign = (c: Campaign) =>
    setDialog({
      title: c.name,
      body: `운영 기간: ${c.start_date} ~ ${c.end_date}\n채널: ${c.channel} · 상태: ${c.status}\n\n선택 조회 기간 내 대상 ${num(c.target)}명 / 구매 ${num(c.converted)}명\n전환율 ${pct(c.conversion)}\n기여 매출 ${money(c.revenue)}\n집행액 ${money(c.spent)} / 예산 ${money(c.planned)}\n\nDB의 캠페인 대상·완료 주문·일별 집행 이력을 집계한 결과입니다.`,
    });
  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await fetch(`/api/export?${query}`);
      if (!r.ok) throw new Error("CSV 조회에 실패했습니다.");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "hyundai-dw-summary.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast("현재 조회 조건의 DB 집계 CSV를 다운로드했습니다.");
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  if (!bootstrap || !draft || !filters)
    return (
      <div className="startup">
        <Database size={36} />
        <h1>현대백화점 DW</h1>
        {startupError ? (
          <>
            <p role="alert">{startupError}</p>
            <p>
              프로젝트 터미널에서 npm run dev를 실행해 API와 DB를 함께
              시작하세요.
            </p>
            <button className="primary" onClick={() => location.reload()}>
              다시 연결
            </button>
          </>
        ) : (
          <p role="status">샘플 데이터베이스에 연결하고 있습니다…</p>
        )}
      </div>
    );
  return (
    <div className={`app-shell ${page === "lineage" ? "dark-mode" : ""}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
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
          <span className="brand-name">
            {bootstrap.settings.workspaceName}
            <small>DATA WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE · 본사 분석</div>
        <nav aria-label="주 메뉴">
          {(Object.keys(pageNames) as Page[]).map((p, i) => {
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
            SQLite · 생성 샘플 데이터
          </div>
          <p>
            샘플 데이터 기준일
            <br />
            <strong>{bootstrap.seed.end_date} KST</strong>
          </p>
          <button
            className="help-button"
            onClick={() =>
              setDialog({
                title: "DB 조회 안내",
                body: "기간·점포·채널을 고른 뒤 조회를 누르면 SQL 집계 결과를 표시합니다. 매출 분석에서는 개별 완료 주문을 검색할 수 있습니다.\n\n비교 기간은 조회 시작일 직전의 동일한 일수입니다. 비율의 분모가 0이면 —, 비교 기준이 없으면 비교 기준 없음으로 표시합니다.\n\n데이터는 최초 실행 시 생성되어 DB에 저장됩니다. 실제 현대백화점 고객·거래 데이터는 아닙니다.",
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
              SQLite 연결
            </span>
            {bootstrap.settings.alertsEnabled && (
              <button
                className="icon-button notification"
                aria-label="알림 보기"
                onClick={() =>
                  setDialog({
                    title: "DB 적재 상태",
                    body: catalog.data
                      ? catalog.data.pipelines
                          .map(
                            (p) =>
                              `${p.name}: ${p.status === "success" ? "성공" : p.status} · ${num(p.processed_rows)}행\n${timestamp(p.finished_at)}`,
                          )
                          .join("\n\n")
                      : catalog.error || "적재 이력을 조회 중입니다.",
                  })
                }
              >
                <Bell size={17} />
              </button>
            )}
            <span className="user-name">로컬 워크스페이스</span>
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
                    ? "데이터 리니지"
                    : pageNames[page]}
              </h1>
              <p>{descriptions[page]}</p>
            </div>
            <button
              className="outline"
              onClick={() => setRevision((v) => v + 1)}
            >
              <RefreshCw size={14} /> DB 새로고침
            </button>
          </div>
          {analyticPage && (
            <>
              <form
                className="query-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  const length =
                    (Date.parse(draft.end) - Date.parse(draft.start)) /
                      86400000 +
                    1;
                  if (!Number.isFinite(length) || length < 1 || length > 365) {
                    setToast(
                      "시작일·종료일을 확인하세요. 최대 365일까지 조회할 수 있습니다.",
                    );
                    return;
                  }
                  setFilters({ ...draft });
                  setRevision((v) => v + 1);
                }}
              >
                <label>
                  조회 기간
                  <select
                    aria-label="조회 기간"
                    value={period}
                    onChange={(e) => {
                      setPeriod(e.target.value);
                      if (e.target.value !== "custom")
                        setDraft({
                          ...draft,
                          start: dateAdd(
                            bootstrap.seed.end_date,
                            -Number(e.target.value) + 1,
                          ),
                          end: bootstrap.seed.end_date,
                        });
                    }}
                  >
                    <option value="7">최근 7일</option>
                    <option value="30">최근 30일</option>
                    <option value="90">최근 90일</option>
                    <option value="custom">직접 지정</option>
                  </select>
                </label>
                <label>
                  시작일
                  <input
                    aria-label="시작일"
                    type="date"
                    required
                    value={draft.start}
                    onChange={(e) => {
                      setPeriod("custom");
                      setDraft({ ...draft, start: e.target.value });
                    }}
                  />
                </label>
                <label>
                  종료일
                  <input
                    aria-label="종료일"
                    type="date"
                    required
                    value={draft.end}
                    onChange={(e) => {
                      setPeriod("custom");
                      setDraft({ ...draft, end: e.target.value });
                    }}
                  />
                </label>
                <label>
                  점포
                  <select
                    aria-label="점포"
                    value={draft.store}
                    onChange={(e) =>
                      setDraft({ ...draft, store: e.target.value })
                    }
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
                    aria-label="채널"
                    value={draft.channel}
                    onChange={(e) =>
                      setDraft({ ...draft, channel: e.target.value })
                    }
                  >
                    <option value="">전체 채널</option>
                    {bootstrap.channels.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <button className="primary" disabled={analysis.loading}>
                  조회
                </button>
              </form>
              <div className="view-meta">
                <span>
                  적용 조건: {filters.start} ~ {filters.end} ·{" "}
                  {bootstrap.stores.find((s) => String(s.id) === filters.store)
                    ?.name || "전체 점포"}{" "}
                  · {filters.channel || "전체 채널"}
                </span>
                <button
                  className="text-button"
                  disabled={analysis.loading || !!analysis.error || exporting}
                  onClick={exportCsv}
                >
                  <ArrowDownToLine size={14} />
                  {exporting ? "다운로드 중…" : "요약 다운로드"}
                </button>
              </div>
            </>
          )}
          {analyticPage &&
            (analysis.loading ? (
              <div className="loading-panel" role="status">
                DB에서 조회하고 있습니다…
              </div>
            ) : analysis.error ? (
              <div className="loading-panel" role="alert">
                <p>{analysis.error}</p>
                <button
                  className="primary"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  다시 조회
                </button>
              </div>
            ) : (
              analysis.data && (
                <>
                  <div className="range-note">
                    비교 기간 {analysis.data.range.previousStart} ~{" "}
                    {analysis.data.range.previousEnd} · 샘플 보유 기간{" "}
                    {bootstrap.seed.start_date} ~ {bootstrap.seed.end_date}
                  </div>
                  {analysis.data.summary.orders === 0 && (
                    <div className="definition-note">
                      선택 조건에 완료 주문이 없습니다. 실제 조회 결과를
                      표시합니다.
                    </div>
                  )}
                  <AnalysisPages
                    page={page}
                    data={analysis.data}
                    query={query}
                    navigate={navigate}
                    onCampaign={campaign}
                  />
                </>
              )
            ))}
          {["catalog", "lineage"].includes(page) &&
            (catalog.loading ? (
              <div className="loading-panel" role="status">
                DB 스키마와 행 수를 조회하고 있습니다…
              </div>
            ) : catalog.error ? (
              <div className="loading-panel" role="alert">
                <p>{catalog.error}</p>
                <button
                  className="primary"
                  onClick={() => setRevision((v) => v + 1)}
                >
                  다시 조회
                </button>
              </div>
            ) : (
              catalog.data &&
              (page === "catalog" ? (
                <CatalogPage
                  data={catalog.data}
                  onOpen={(id) => {
                    setSelectedAsset(id);
                    navigate("lineage");
                  }}
                />
              ) : (
                <LineagePage
                  key={selectedAsset}
                  initial={selectedAsset}
                  data={catalog.data}
                />
              ))
            ))}
          {page === "settings" && (
            <SettingsPage
              bootstrap={bootstrap}
              onSave={(settings) => {
                setBootstrap({ ...bootstrap, settings });
                setToast("DB에 설정을 저장했습니다.");
              }}
            />
          )}
          <footer>
            <span>
              <span className="footer-dot" />
              SAMPLE DATABASE
            </span>
            <p>
              생성 샘플 데이터 · 모든 수치는 SQLite 조회 결과 · 인사이트는 집계
              기반 규칙 요약
            </p>
            {analyticPage && (
              <button className="text-button" onClick={reset}>
                조건 초기화
              </button>
            )}
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
