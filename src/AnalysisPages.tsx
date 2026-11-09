import { useState } from "react";
import { Search } from "lucide-react";
import { useApi } from "./api";
import type { Analytics, Campaign, OrderList } from "./api";
import type { Page } from "./data";
import {
  Panel,
  Kpi,
  Trend,
  DataTable,
  Progress,
  BudgetSummary,
  num,
  pct,
  money,
  compactMoney,
} from "./components";
export function CampaignTable({
  data,
  onSelect,
  limit,
}: {
  data: Analytics;
  onSelect: (c: Campaign) => void;
  limit?: number;
}) {
  return (
    <DataTable
      headers={[
        "캠페인",
        "대상 / 구매",
        "전환율",
        "집행액 / 예산",
        "집행률",
        "상태",
      ]}
      rows={data.campaigns.items.slice(0, limit).map((c) => [
        <button className="text-button blue" onClick={() => onSelect(c)}>
          {c.name}
        </button>,
        `${num(c.target)} / ${num(c.converted)}명`,
        pct(c.conversion),
        `${compactMoney(c.spent)} / ${compactMoney(c.planned)}`,
        <div className="inline-progress">
          <Progress value={c.progress} />
          {pct(c.progress)}
        </div>,
        <span className="status">{c.status}</span>,
      ])}
    />
  );
}
function Orders({ query }: { query: string }) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [revision, setRevision] = useState(0);
  const state = useApi<OrderList>(
    `/api/orders?${query}&page=${page}&q=${encodeURIComponent(q)}`,
    revision,
  );
  return (
    <Panel
      title="완료 주문 조회"
      aside={
        <span className="muted">
          {state.data ? `${num(state.data.total)}건 · 20건씩 조회` : ""}
        </span>
      }
    >
      <form
        className="catalog-tools"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(search);
        }}
      >
        <label className="search">
          <Search size={16} />
          <input
            aria-label="주문 검색"
            placeholder="주문 번호 또는 샘플고객 이름"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="primary">검색</button>
      </form>
      {state.loading ? (
        <div className="empty" role="status">
          주문을 조회하고 있습니다…
        </div>
      ) : state.error ? (
        <div className="empty" role="alert">
          {state.error}{" "}
          <button className="outline" onClick={() => setRevision((v) => v + 1)}>
            다시 조회
          </button>
        </div>
      ) : (
        state.data && (
          <>
            <DataTable
              headers={[
                "주문 번호",
                "주문일",
                "고객",
                "점포",
                "채널",
                "결제 금액",
                "결제 수단",
              ]}
              rows={state.data.items.map((o) => [
                o.id,
                o.date,
                o.customer,
                o.store,
                o.channel,
                money(o.amount),
                o.method,
              ])}
            />
            <div className="pagination">
              <button
                className="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                이전
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(state.data.total / 20))}
              </span>
              <button
                className="outline"
                disabled={page * 20 >= state.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                다음
              </button>
            </div>
          </>
        )
      )}
    </Panel>
  );
}
export default function AnalysisPages({
  page,
  data,
  query,
  navigate,
  onCampaign,
}: {
  page: Page;
  data: Analytics;
  query: string;
  navigate: (p: Page) => void;
  onCampaign: (c: Campaign) => void;
}) {
  const d = data;
  return (
    <>
      {page === "overview" && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="총 매출"
              value={compactMoney(d.summary.sales)}
              change={d.summary.salesChange}
            />
            <Kpi
              label="활성 구매 고객"
              value={num(d.summary.activeCustomers)}
              change={d.summary.customerChange}
            />
            <Kpi
              label="캠페인 전환율"
              value={pct(d.campaigns.conversion)}
              change={d.campaigns.conversionChange}
              unit="%p"
            />
            <Kpi
              label="예산 집행률"
              value={pct(d.budget.execution)}
              note={`잔여 ${compactMoney(d.budget.remaining)}`}
              warning={d.budget.remaining < 0}
            />
          </div>
          <div className="overview-middle">
            <Panel
              title="매출 추이"
              aside={<span className="muted">일별 · 단위 원</span>}
            >
              <Trend data={d} />
              <div className="chart-summary">
                <span>
                  완료 주문 <strong>{num(d.summary.orders)}건</strong>
                </span>
                <button
                  className="text-button blue"
                  onClick={() => navigate("sales")}
                >
                  주문 상세 조회 →
                </button>
              </div>
            </Panel>
            <Panel
              title="데이터 인사이트"
              className="insights"
              aside={<span className="purple-tag">SQL 집계 기반</span>}
            >
              <div className="insight-body">
                {d.insights.map((i) => (
                  <div key={i.title}>
                    <h3>{i.title}</h3>
                    <p>{i.body}</p>
                  </div>
                ))}
                <p className="muted">규칙 기반 자동 요약 · 생성형 AI 미연결</p>
              </div>
            </Panel>
          </div>
          <div className="overview-bottom">
            <Panel
              title="캠페인 성과"
              aside={
                <button
                  className="text-button blue"
                  onClick={() => navigate("campaigns")}
                >
                  전체 보기 →
                </button>
              }
            >
              <CampaignTable data={d} onSelect={onCampaign} limit={3} />
            </Panel>
            <Panel title="예산 대비 실적">
              <BudgetSummary data={d} />
            </Panel>
          </div>
        </>
      )}
      {page === "customers" && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="누적 구매 고객"
              value={num(d.customers.total)}
              change={d.customers.totalChange}
            />
            <Kpi
              label="신규 첫 구매 고객"
              value={num(d.customers.new)}
              change={d.customers.newChange}
            />
            <Kpi
              label="기간 내 재구매율"
              value={pct(d.customers.repurchaseRate)}
              change={d.customers.repurchaseChange}
              unit="%p"
            />
            <Kpi
              label="30일 이상 미구매 고객"
              value={num(d.customers.dormant)}
              note="조회 종료일 기준 · 동일 점포/채널"
            />
          </div>
          <div className="customer-grid">
            <Panel
              title="고객 등급 구성"
              aside={<span className="muted">누적 구매 고객 기준</span>}
            >
              <div className="grade-list">
                {d.customers.grades.map((g) => (
                  <div className="grade" key={g.grade}>
                    <span>
                      {g.grade} · {num(g.count)}명
                    </span>
                    <Progress value={g.share} />
                    <strong>{pct(g.share)}</strong>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="고객 분석 요약" className="insights">
              <div className="insight-body">
                <h3>기간 내 구매 고객 {num(d.customers.active)}명</h3>
                <p>
                  이 중 {num(d.customers.new)}명이 선택한 점포·채널에서 처음
                  구매했습니다. 기간 내 2회 이상 구매한 고객은{" "}
                  {num(d.customers.repeat)}명입니다.
                </p>
                <p>
                  누적 고객은 조회 종료일까지 구매 이력이 있는 고객입니다. 휴면
                  위험은 마지막 구매 이후 30일 이상 경과한 고객입니다.
                </p>
              </div>
            </Panel>
          </div>
          <Panel
            title="고객 세그먼트"
            aside={
              <span className="muted">
                세그먼트 간 중복 가능 · 매출은 선택 기간 기준
              </span>
            }
          >
            <DataTable
              headers={[
                "고객군",
                "고객 수",
                "매출",
                "매출 기여",
                "평균 주문액",
              ]}
              rows={d.customers.segments.map((s) => [
                s.name,
                num(s.count),
                money(s.sales),
                pct(s.share),
                money(s.averageOrder),
              ])}
            />
          </Panel>
        </>
      )}
      {page === "sales" && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="총 매출"
              value={compactMoney(d.summary.sales)}
              change={d.summary.salesChange}
            />
            <Kpi
              label="완료 주문"
              value={num(d.summary.orders) + "건"}
              change={d.summary.orderChange}
            />
            <Kpi
              label="평균 주문 금액"
              value={money(d.summary.averageOrder)}
              change={d.summary.averageChange}
            />
            <Kpi
              label="매출 목표 달성률"
              value={pct(d.budget.achievement)}
              note={`목표 ${compactMoney(d.budget.salesTarget)}`}
            />
          </div>
          <Panel title="일별 매출 추이">
            <Trend data={d} />
          </Panel>
          <div className="customer-grid">
            <Panel title="상품군별 매출">
              <DataTable
                headers={["상품군", "매출액", "판매 수량", "비중"]}
                rows={d.sales.categories.map((c) => [
                  c.category,
                  money(c.sales),
                  num(c.quantity),
                  pct(c.share),
                ])}
              />
            </Panel>
            <Panel title="점포별 실적">
              <DataTable
                headers={["점포", "매출", "주문"]}
                rows={d.sales.byStore.map((s) => [
                  s.name,
                  compactMoney(s.sales),
                  num(s.orders),
                ])}
              />
            </Panel>
          </div>
          <Orders key={query} query={query} />
        </>
      )}
      {page === "campaigns" && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="조회 기간 캠페인"
              value={num(d.campaigns.items.length) + "개"}
              note={`진행 중 ${d.campaigns.items.filter((c) => c.status === "진행 중").length}개 · 종료일 기준`}
            />
            <Kpi
              label="캠페인 대상"
              value={num(d.campaigns.target) + "명"}
              note="기간 내 대상 지정 · 캠페인 간 중복 포함"
            />
            <Kpi
              label="구매 전환율"
              value={pct(d.campaigns.conversion)}
              change={d.campaigns.conversionChange}
              unit="%p"
            />
            <Kpi
              label="캠페인 기여 매출"
              value={compactMoney(d.campaigns.revenue)}
              note={`구매 전환 ${num(d.campaigns.converted)}명`}
            />
          </div>
          <Panel
            title="캠페인별 성과"
            aside={<span className="muted">캠페인명을 눌러 상세 확인</span>}
          >
            <CampaignTable data={d} onSelect={onCampaign} />
          </Panel>
          <div className="definition-note">
            전환율 = 기간 내 대상 지정 고객 중 같은 기간 캠페인에 연결된 완료
            주문이 있는 고객 / 대상 고객. 여러 캠페인 대상 고객은 캠페인별로
            집계합니다. 집행액은 CRM 캠페인 예산과 일치합니다.
          </div>
        </>
      )}
      {page === "app" && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="기간 내 활성 사용자"
              value={num(d.app.users)}
              change={d.app.userChange}
            />
            <Kpi
              label="일 평균 활성 사용자"
              value={num(d.app.dailyAverage)}
              note={`${d.range.days}일 평균 · 일별 고유 고객`}
            />
            <Kpi
              label="세션 구매 전환율"
              value={pct(d.app.conversion)}
              change={d.app.conversionChange}
              unit="%p"
            />
            <Kpi
              label="평균 이용 시간"
              value={`${Math.floor(d.app.duration / 60)}분 ${d.app.duration % 60}초`}
              note={`총 ${num(d.app.sessions)}세션`}
            />
          </div>
          {d.range.channel === "오프라인" && (
            <div className="definition-note">
              앱 세션은 모바일 앱 채널에만 존재합니다. 모바일 앱 또는 전체
              채널로 조회하세요.
            </div>
          )}
          <Panel title="일별 활성 사용자">
            <Trend data={d} app />
          </Panel>
          <Panel
            title="구매 전환 퍼널"
            aside={<span className="muted">세션 단위 · 최초 방문 대비</span>}
          >
            <div className="funnel">
              {[
                ["앱 방문", d.app.sessions],
                ["상품 조회", d.app.viewed],
                ["장바구니", d.app.cart],
                ["구매 완료", d.app.purchased],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <Progress
                    value={
                      d.app.sessions
                        ? (Number(value) / d.app.sessions) * 100
                        : null
                    }
                  />
                  <strong>{num(Number(value))}건</strong>
                  <strong>
                    {pct(
                      d.app.sessions
                        ? (Number(value) / d.app.sessions) * 100
                        : null,
                    )}
                  </strong>
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
              label="배정 예산"
              value={compactMoney(d.budget.planned)}
              note="선택 기간·점포·채널 합계"
            />
            <Kpi
              label="집행 금액"
              value={compactMoney(d.budget.spent)}
              note={`집행률 ${pct(d.budget.execution)}`}
            />
            <Kpi
              label="매출 목표"
              value={compactMoney(d.budget.salesTarget)}
              note={`달성률 ${pct(d.budget.achievement)}`}
            />
            <Kpi
              label="잔여 예산"
              value={compactMoney(d.budget.remaining)}
              note="배정 예산 − 집행 금액"
              warning={d.budget.remaining < 0}
            />
          </div>
          <Panel title="예산 대비 실적">
            <BudgetSummary data={d} />
          </Panel>
          <Panel title="부문별 예산 집행">
            <DataTable
              headers={[
                "부문",
                "배정 예산",
                "집행 금액",
                "집행률",
                "잔여 예산",
              ]}
              rows={d.budget.departments.map((b) => [
                b.department,
                money(b.planned),
                money(b.spent),
                pct(b.execution),
                money(b.planned - b.spent),
              ])}
            />
          </Panel>
        </>
      )}
    </>
  );
}
