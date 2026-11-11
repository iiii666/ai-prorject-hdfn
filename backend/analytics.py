from datetime import date

from . import db
from .common import change, date_add, fail, fixed, js_round, number, ratio, stamp


async def settings():
    return {
        r["key"]: r["value"] == "true" if r["key"] == "alertsEnabled" else r["value"]
        for r in await db.all("SELECT key,value FROM settings")
    }


async def bootstrap():
    op = await db.one("SELECT value FROM settings WHERE key='operationalStart'")
    return dict(
        stores=await db.all("SELECT * FROM stores"),
        channels=["모바일 앱", "오프라인"],
        seed=await db.one("SELECT * FROM seed_info"),
        settings=await settings(),
        operationalStart=op["value"] if op else None,
    )


async def filters(params):
    seed = await db.one("SELECT * FROM seed_info")
    days = number(params.get("days") or 30)
    if not days.is_integer() or not 1 <= days <= 365:
        fail("조회 기간은 1~365일이어야 합니다.")
    end = params.get("end") or seed["end_date"]
    try:
        if date.fromisoformat(end).isoformat() != end:
            raise ValueError()
    except (ValueError, TypeError):
        fail("종료일을 확인하세요.")
    start = params.get("start") or date_add(end, -int(days) + 1)
    try:
        if date.fromisoformat(start).isoformat() != start or start > end:
            raise ValueError()
    except (ValueError, TypeError):
        fail("시작일과 종료일을 확인하세요.")
    length = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    if length > 365:
        fail("한 번에 최대 365일까지 조회할 수 있습니다.")
    store, channel = params.get("store") or "", params.get("channel") or ""
    if store and store not in [
        str(s["id"]) for s in await db.all("SELECT id FROM stores")
    ]:
        fail("존재하지 않는 점포입니다.")
    if channel and channel not in ["모바일 앱", "오프라인"]:
        fail("지원하지 않는 채널입니다.")
    return dict(
        start=start,
        end=end,
        days=length,
        store=store,
        channel=channel,
        previousStart=date_add(start, -length),
        previousEnd=date_add(start, -1),
    )


def scope(f, alias=""):
    p = alias + "." if alias else ""
    return (
        (" AND " + p + "store_id=?" if f.get("store") else "")
        + (" AND " + p + "channel=?" if f.get("channel") else ""),
        ([int(f["store"])] if f.get("store") else [])
        + ([f["channel"]] if f.get("channel") else []),
    )


async def summary(f, start=None, end=None):
    q, args = scope(f)
    return await db.one(
        f"SELECT COALESCE(SUM(amount),0) sales,COUNT(*) orders,COUNT(DISTINCT customer_id) activeCustomers FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?{q}",
        [start or f["start"], end or f["end"], *args],
    )


async def customer_metrics(f, start=None, end=None):
    start, end = start or f["start"], end or f["end"]
    q, args = scope(f)
    rows = await db.all(
        f"SELECT c.id,c.grade,MIN(o.ordered_at) firstDate,MAX(o.ordered_at) lastDate,COUNT(*) lifetimeOrders,SUM(CASE WHEN o.ordered_at BETWEEN ? AND ? THEN 1 ELSE 0 END) periodOrders,SUM(CASE WHEN o.ordered_at BETWEEN ? AND ? THEN o.amount ELSE 0 END) periodSales FROM dw_fact_orders o JOIN customers c ON c.id=o.customer_id WHERE o.ordered_at<=?{q} GROUP BY c.id",
        [start, end, start, end, end, *args],
    )
    active = [r for r in rows if r["periodOrders"] > 0]
    fresh = [r for r in rows if r["firstDate"] >= start]
    repeat = [r for r in active if r["periodOrders"] >= 2]
    dormant = [r for r in rows if r["lastDate"] < date_add(end, -29)]
    sales = sum(r["periodSales"] for r in active)

    def segment(name, items):
        revenue = sum(r["periodSales"] for r in items)
        orders = sum(r["periodOrders"] for r in items)
        return dict(
            name=name,
            count=len(items),
            sales=revenue,
            share=ratio(revenue, sales),
            averageOrder=js_round(revenue / orders) if orders else 0,
        )

    return dict(
        total=len(rows),
        active=len(active),
        new=len(fresh),
        repeat=len(repeat),
        repurchaseRate=ratio(len(repeat), len(active)),
        dormant=len(dormant),
        grades=[
            dict(
                grade=g,
                count=sum(r["grade"] == g for r in rows),
                share=ratio(sum(r["grade"] == g for r in rows), len(rows)),
            )
            for g in ["일반", "실버", "골드", "VIP"]
        ],
        segments=[
            segment("VIP 우수 고객", [r for r in active if r["grade"] == "VIP"]),
            segment("신규 첫 구매", fresh),
            segment("재구매 고객", repeat),
            segment("휴면 위험 고객", dormant),
        ],
    )


async def campaign_metrics(f):
    q, args = scope(f, "t")
    sp, sp_args = scope(f)
    campaigns = await db.all(
        "SELECT * FROM campaigns WHERE start_date<=? AND end_date>=?"
        + (" AND channel=?" if f["channel"] else ""),
        [f["end"], f["start"]] + ([f["channel"]] if f["channel"] else []),
    )
    out = []
    for c in campaigns:
        t = await db.one(
            f"SELECT COUNT(*) target,COALESCE(SUM(EXISTS(SELECT 1 FROM dw_fact_orders o WHERE o.campaign_target_id=t.id AND o.ordered_at BETWEEN ? AND ?)),0) converted FROM campaign_targets t WHERE t.campaign_id=? AND t.targeted_at BETWEEN ? AND ?{q}",
            [f["start"], f["end"], c["id"], f["start"], f["end"], *args],
        )
        p = await db.one(
            f"SELECT COALESCE(SUM(planned),0) planned,COALESCE(SUM(spent),0) spent FROM campaign_spend WHERE campaign_id=? AND date BETWEEN ? AND ?{sp}",
            [c["id"], f["start"], f["end"], *sp_args],
        )
        r = await db.one(
            f"SELECT COALESCE(SUM(o.amount),0) revenue FROM dw_fact_orders o JOIN campaign_targets t ON t.id=o.campaign_target_id WHERE t.campaign_id=? AND t.targeted_at BETWEEN ? AND ? AND o.ordered_at BETWEEN ? AND ?{q}",
            [c["id"], f["start"], f["end"], f["start"], f["end"], *args],
        )
        out.append(
            {
                **c,
                **t,
                **p,
                **r,
                "conversion": ratio(t["converted"], t["target"]),
                "progress": ratio(p["spent"], p["planned"]),
                "status": "완료" if c["end_date"] < f["end"] else "진행 중",
            }
        )
    return out


async def app_metrics(f, start=None, end=None):
    q, args = scope(f)
    args = [start or f["start"], end or f["end"], *args]
    r = await db.one(
        f"SELECT COUNT(*) sessions,COUNT(DISTINCT customer_id) users,COALESCE(SUM(viewed_product),0) viewed,COALESCE(SUM(added_cart),0) cart,COUNT(order_id) purchased,COALESCE(AVG(duration_seconds),0) duration FROM app_sessions WHERE session_date BETWEEN ? AND ?{q}",
        args,
    )
    daily = await db.all(
        f"SELECT session_date date,COUNT(DISTINCT customer_id) users,COUNT(*) sessions FROM app_sessions WHERE session_date BETWEEN ? AND ?{q} GROUP BY session_date",
        args,
    )
    return {
        **r,
        "duration": js_round(r["duration"]),
        "conversion": ratio(r["purchased"], r["sessions"]),
        "dailyAverage": js_round(sum(d["users"] for d in daily) / f["days"]),
        "daily": daily,
    }


def campaign_total(items):
    r = {
        k: sum(c[k] for c in items)
        for k in ["target", "converted", "spent", "planned", "revenue"]
    }
    return {**r, "conversion": ratio(r["converted"], r["target"])}


def difference(a, b):
    return fixed(a - b) if a is not None and b is not None else None


async def analytics(f):
    q, args = scope(f)
    current = await summary(f)
    previous = await summary(f, f["previousStart"], f["previousEnd"])
    customers = await customer_metrics(f)
    old = await customer_metrics(f, f["previousStart"], f["previousEnd"])
    campaigns = await campaign_metrics(f)
    old_campaigns = await campaign_metrics(
        {**f, "start": f["previousStart"], "end": f["previousEnd"]}
    )
    budget = await db.all(
        f"SELECT department,SUM(planned) planned,SUM(spent) spent,SUM(sales_target) salesTarget FROM budget_daily WHERE date BETWEEN ? AND ?{q} GROUP BY department",
        [f["start"], f["end"], *args],
    )
    totals = {k: sum(b[k] for b in budget) for k in ["planned", "spent", "salesTarget"]}
    trends = await db.all(
        f"SELECT date,SUM(sales) sales,SUM(orders) orders FROM mart_sales_daily WHERE date BETWEEN ? AND ?{q} GROUP BY date",
        [f["previousStart"], f["end"], *args],
    )
    by_date = {r["date"]: r for r in trends}
    trend = []
    for i in range(f["days"]):
        d = date_add(f["start"], i)
        now = by_date.get(d, {})
        prev = by_date.get(date_add(f["previousStart"], i), {})
        trend.append(
            dict(
                date=d,
                sales=now.get("sales", 0),
                previous=prev.get("sales", 0),
                orders=now.get("orders", 0),
            )
        )
    sq, sa = scope(f, "o")
    categories = await db.all(
        f"SELECT p.category,SUM(i.quantity*i.unit_price) sales,SUM(i.quantity) quantity FROM order_items i JOIN dw_fact_orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id WHERE o.ordered_at BETWEEN ? AND ?{sq} GROUP BY p.category ORDER BY sales DESC",
        [f["start"], f["end"], *sa],
    )
    stores = await db.all(
        f"SELECT s.name,SUM(o.amount) sales,COUNT(*) orders FROM dw_fact_orders o JOIN stores s ON s.id=o.store_id WHERE o.ordered_at BETWEEN ? AND ?{sq} GROUP BY s.id ORDER BY sales DESC",
        [f["start"], f["end"], *sa],
    )
    app = await app_metrics(f)
    prev_app = await app_metrics(f, f["previousStart"], f["previousEnd"])
    ct, pct = campaign_total(campaigns), campaign_total(old_campaigns)
    sales_change = change(current["sales"], previous["sales"])
    best = next(
        iter(
            sorted(
                [c for c in campaigns if c["target"] > 0],
                key=lambda c: -(c["conversion"] or 0),
            )
        ),
        None,
    )
    sales_body = "선택한 기간·점포·채널에 완료 주문이 없습니다."
    if current["orders"]:
        tail = (
            "비교 기간 매출이 없어 증감률을 계산할 수 없습니다."
            if sales_change is None
            else f"직전 동일 길이 기간 대비 {abs(sales_change):g}% "
            + ("증가" if sales_change >= 0 else "감소")
            + "했습니다."
        )
        sales_body = f"선택 기간 완료 주문 {current['orders']:,}건, 매출 {current['sales']:,}원입니다. {tail}"
    insights = [
        dict(title="매출 흐름", body=sales_body),
        dict(
            title="캠페인 전환",
            body=f"{best['name']} 캠페인의 대상 {best['target']}명 중 {best['converted']}명이 구매했습니다. 전환율은 {best['conversion']:g}%입니다."
            if best
            else "선택 조건에 해당하는 캠페인 대상 고객이 없습니다.",
        ),
        dict(
            title="예산 집행",
            body=f"배정 예산 {totals['planned']:,}원 중 {totals['spent']:,}원을 사용했습니다. 잔여 예산은 {totals['planned'] - totals['spent']:,}원입니다."
            if totals["planned"]
            else "선택 조건에 등록된 예산이 없습니다.",
        ),
    ]
    daily = {r["date"]: r for r in app["daily"]}
    return dict(
        range=f,
        seed=await db.one("SELECT * FROM seed_info"),
        queriedAt=stamp(),
        summary={
            **current,
            "averageOrder": js_round(current["sales"] / current["orders"])
            if current["orders"]
            else 0,
            "salesChange": sales_change,
            "customerChange": change(
                current["activeCustomers"], previous["activeCustomers"]
            ),
            "orderChange": change(current["orders"], previous["orders"]),
            "averageChange": change(
                current["sales"] / current["orders"] if current["orders"] else 0,
                previous["sales"] / previous["orders"] if previous["orders"] else 0,
            ),
        },
        customers={
            **customers,
            "totalChange": change(customers["total"], old["total"]),
            "newChange": change(customers["new"], old["new"]),
            "repurchaseChange": difference(
                customers["repurchaseRate"], old["repurchaseRate"]
            ),
        },
        sales=dict(
            trend=trend,
            categories=[
                {**c, "share": ratio(c["sales"], current["sales"])} for c in categories
            ],
            byStore=stores,
        ),
        campaigns={
            **ct,
            "items": campaigns,
            "conversionChange": difference(ct["conversion"], pct["conversion"]),
        },
        app={
            **app,
            "userChange": change(app["users"], prev_app["users"]),
            "conversionChange": difference(app["conversion"], prev_app["conversion"]),
            "daily": [
                dict(
                    date=t["date"],
                    users=daily.get(t["date"], {}).get("users", 0),
                    sessions=daily.get(t["date"], {}).get("sessions", 0),
                )
                for t in trend
            ],
        },
        budget={
            **totals,
            "remaining": totals["planned"] - totals["spent"],
            "execution": ratio(totals["spent"], totals["planned"]),
            "achievement": ratio(current["sales"], totals["salesTarget"]),
            "departments": [
                {**b, "execution": ratio(b["spent"], b["planned"])} for b in budget
            ],
        },
        insights=insights,
    )


async def catalog():
    seed = await db.one("SELECT * FROM seed_info")
    known = {r["name"] for r in await db.table_names()}
    assets = []
    for a in await db.all("SELECT * FROM asset_metadata"):
        if a["id"] in known:
            assets.append(
                {
                    **a,
                    "rows": (await db.count_rows(a["id"]))["count"],
                    "columns": await db.columns(a["id"]),
                    "updatedAt": seed["created_at"],
                }
            )
    return dict(
        assets=assets,
        edges=await db.all("SELECT source,target FROM asset_edges"),
        pipelines=await db.all("SELECT * FROM pipeline_runs"),
        updatedAt=seed["created_at"],
    )


async def order_list(f, params):
    page = number(params.get("page") or 1)
    if not page.is_integer() or not 1 <= page <= 100000:
        fail("페이지 번호가 올바르지 않습니다.")
    page = int(page)
    q, args = scope(f, "o")
    search = (params.get("q") or "").strip()[:100]
    search_sql = " AND (CAST(o.id AS TEXT)=? OR c.name LIKE ?)" if search else ""
    args = [f["start"], f["end"], *args] + ([search, f"%{search}%"] if search else [])
    source = f"FROM dw_fact_orders o JOIN customers c ON c.id=o.customer_id JOIN stores s ON s.id=o.store_id WHERE o.ordered_at BETWEEN ? AND ?{q}{search_sql}"
    return dict(
        page=page,
        pageSize=20,
        total=(await db.one(f"SELECT COUNT(*) total {source}", args))["total"],
        items=await db.all(
            f"SELECT o.id,c.name customer,c.grade,s.name store,o.channel,o.ordered_at date,o.amount,o.method {source} ORDER BY o.ordered_at DESC,o.id DESC LIMIT 20 OFFSET ?",
            [*args, (page - 1) * 20],
        ),
    )
