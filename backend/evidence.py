from . import db
from .analytics import scope
from .common import js_round, percent
from .evidence_sql import QUERIES


async def build_evidence(*, year, store, channel, total, coverageStart, coverageEnd):
    start = f"{year}-01-01"
    end = min(f"{year}-12-31", coverageEnd)
    prior_end = f"{year - 1}" + end[4:]
    f = dict(store=store, channel=channel)
    _, sa = scope(f)
    args = [start, end, *sa]

    async def query(i, params=None, single=False):
        sql = QUERIES[i].format(
            **{
                f"scope_{alias or 'plain'}": scope(f, alias)[0]
                for alias in ["", "o", "b", "t", "a"]
            }
        )
        return await (db.one if single else db.all)(
            sql, args if params is None else params
        )

    def enriched(rows):
        return [
            {
                **r,
                "share": percent(r["sales"], total),
                "averageOrder": js_round(r["sales"] / r["orders"])
                if r["orders"]
                else 0,
            }
            for r in rows
        ]

    previous = {
        r["store_id"]: r["sales"]
        for r in await query("previous_store", [f"{year - 1}-01-01", prior_end, *sa])
    }
    by_store = []
    for i, r in enumerate(enriched(await query("by_store"))):
        p = previous.get(r["storeId"], 0)
        by_store.append(
            {
                **r,
                "rank": i + 1,
                "previousSales": p,
                "change": percent(r["sales"] - p, p),
            }
        )
    by_channel = enriched(await query("by_channel"))
    by_category = enriched(await query("by_category"))
    monthly_store = await query("monthly_store")
    monthly_category = await query("monthly_category")
    by_grade = enriched(await query("by_grade"))
    budget_store = await query("budget_store")
    departments = await query("departments")
    campaigns = []
    for c in await query("campaigns", [start, end, *args]):
        cost = await query("campaign_cost", [c["id"], *args], True)
        campaigns.append(
            {
                **c,
                **cost,
                "conversion": percent(c["converted"], c["target"]),
                "revenuePerSpend": js_round(c["revenue"] / cost["spent"] * 100) / 100
                if cost["spent"]
                else None,
            }
        )
    app = await query("app_store")
    sources = dict(
        actual=dict(
            table="dw_fact_orders + order_items",
            start=max(start, coverageStart),
            end=end,
            definition="보유 기간 완료 주문 결제액 합계. 일평균으로 생성한 예측 금액이 아님.",
        ),
        previous=dict(
            start=f"{year - 1}-01-01",
            end=prior_end,
            definition="전년도 동일 종료 월일 기준. 보유 기간 이전은 미보유.",
        ),
        budget=dict(
            table="budget_daily",
            start=start,
            end=end,
            definition="매출 실적과 같은 연도·점포·채널·종료일 범위의 목표/예산 합계",
        ),
        campaigns=dict(
            table="campaign_targets + orders + campaign_spend",
            definition="기간 내 대상 지정과 같은 기간 귀속 완료 주문. 전환은 고유 대상 고객 수. 기여 매출은 인과 효과 아님.",
        ),
    )
    return dict(
        byStore=by_store,
        byChannel=by_channel,
        byCategory=by_category,
        monthlyByStore=monthly_store,
        monthlyByCategory=monthly_category,
        byGrade=by_grade,
        budgetByStore=budget_store,
        byDepartment=departments,
        campaigns=campaigns,
        appByStore=app,
        sources=sources,
        verifiedFacts=dict(
            topStore=next(iter(by_store), None),
            topCategory=next(iter(by_category), None),
            topChannel=next(iter(by_channel), None),
            bestCampaign=next(
                iter(
                    sorted(
                        [c for c in campaigns if c["target"]],
                        key=lambda c: (-c["conversion"], c["id"]),
                    )
                ),
                None,
            ),
        ),
        dataAvailability=dict(
            storeSales=bool(by_store),
            channelSales=bool(by_channel),
            categorySales=bool(by_category),
            customerGrades=bool(by_grade),
            budget=bool(budget_store),
            campaigns=bool(campaigns),
            appSessions=bool(app),
        ),
    )
