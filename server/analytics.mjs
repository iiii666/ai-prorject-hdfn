import { all, one, db, dateAdd } from "./db.mjs";
export const ratio = (n, d) => (d ? +((n / d) * 100).toFixed(2) : null);
export const change = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(2) : null);
export const settings = () =>
  Object.fromEntries(
    all("SELECT key,value FROM settings").map((r) => [
      r.key,
      r.key === "alertsEnabled" ? r.value === "true" : r.value,
    ]),
  );
export function bootstrap() {
  return {
    stores: all("SELECT * FROM stores"),
    channels: ["모바일 앱", "오프라인"],
    seed: one("SELECT * FROM seed_info"),
    settings: settings(),
  };
}
export function filters(params) {
  const seed = one("SELECT * FROM seed_info");
  const days = Number(params.get("days") || 30);
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new Error("400:조회 기간은 1~365일이어야 합니다.");
  const validDate = (v) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  const end = params.get("end") || seed.end_date;
  if (!validDate(end)) throw new Error("400:종료일을 확인하세요.");
  const start = params.get("start") || dateAdd(end, -days + 1);
  if (!validDate(start) || !validDate(end) || start > end)
    throw new Error("400:시작일과 종료일을 확인하세요.");
  const length =
    Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (length > 365)
    throw new Error("400:한 번에 최대 365일까지 조회할 수 있습니다.");
  const store = params.get("store") || "",
    channel = params.get("channel") || "";
  if (
    store &&
    !all("SELECT id FROM stores").some((s) => String(s.id) === store)
  )
    throw new Error("400:존재하지 않는 점포입니다.");
  if (channel && !["모바일 앱", "오프라인"].includes(channel))
    throw new Error("400:지원하지 않는 채널입니다.");
  return {
    start,
    end,
    days: length,
    store,
    channel,
    previousStart: dateAdd(start, -length),
    previousEnd: dateAdd(start, -1),
  };
}
function scope(f, alias = "") {
  const p = alias ? alias + "." : "";
  return {
    sql: `${f.store ? ` AND ${p}store_id=?` : ""}${f.channel ? ` AND ${p}channel=?` : ""}`,
    args: [
      ...(f.store ? [Number(f.store)] : []),
      ...(f.channel ? [f.channel] : []),
    ],
  };
}
function summary(f, start = f.start, end = f.end) {
  const q = scope(f);
  return one(
    `SELECT COALESCE(SUM(amount),0) sales,COUNT(*) orders,COUNT(DISTINCT customer_id) activeCustomers FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?${q.sql}`,
    [start, end, ...q.args],
  );
}
function customerMetrics(f, start = f.start, end = f.end) {
  const q = scope(f);
  const rows = all(
    `SELECT c.id,c.grade,MIN(o.ordered_at) firstDate,MAX(o.ordered_at) lastDate,COUNT(*) lifetimeOrders,SUM(CASE WHEN o.ordered_at BETWEEN ? AND ? THEN 1 ELSE 0 END) periodOrders,SUM(CASE WHEN o.ordered_at BETWEEN ? AND ? THEN o.amount ELSE 0 END) periodSales FROM dw_fact_orders o JOIN customers c ON c.id=o.customer_id WHERE o.ordered_at<=?${q.sql} GROUP BY c.id`,
    [start, end, start, end, end, ...q.args],
  );
  const active = rows.filter((r) => r.periodOrders > 0),
    fresh = rows.filter((r) => r.firstDate >= start),
    repeat = active.filter((r) => r.periodOrders >= 2),
    dormant = rows.filter((r) => r.lastDate < dateAdd(end, -29));
  const sales = active.reduce((s, r) => s + r.periodSales, 0);
  const segment = (name, list) => {
    const revenue = list.reduce((s, r) => s + r.periodSales, 0),
      orders = list.reduce((s, r) => s + r.periodOrders, 0);
    return {
      name,
      count: list.length,
      sales: revenue,
      share: ratio(revenue, sales),
      averageOrder: orders ? Math.round(revenue / orders) : 0,
    };
  };
  return {
    total: rows.length,
    active: active.length,
    new: fresh.length,
    repeat: repeat.length,
    repurchaseRate: ratio(repeat.length, active.length),
    dormant: dormant.length,
    grades: ["일반", "실버", "골드", "VIP"].map((grade) => ({
      grade,
      count: rows.filter((r) => r.grade === grade).length,
      share: ratio(rows.filter((r) => r.grade === grade).length, rows.length),
    })),
    segments: [
      segment(
        "VIP 우수 고객",
        active.filter((r) => r.grade === "VIP"),
      ),
      segment("신규 첫 구매", fresh),
      segment("재구매 고객", repeat),
      segment("휴면 위험 고객", dormant),
    ],
  };
}
function campaignMetrics(f) {
  const q = scope(f, "t"),
    sp = scope(f);
  return all(
    "SELECT * FROM campaigns WHERE start_date<=? AND end_date>=?" +
      (f.channel ? " AND channel=?" : ""),
    [f.end, f.start, ...(f.channel ? [f.channel] : [])],
  ).map((c) => {
    const t = one(
      `SELECT COUNT(*) target,COALESCE(SUM(EXISTS(SELECT 1 FROM dw_fact_orders o WHERE o.campaign_target_id=t.id AND o.ordered_at BETWEEN ? AND ?)),0) converted FROM campaign_targets t WHERE t.campaign_id=? AND t.targeted_at BETWEEN ? AND ?${q.sql}`,
      [f.start, f.end, c.id, f.start, f.end, ...q.args],
    );
    const p = one(
      `SELECT COALESCE(SUM(planned),0) planned,COALESCE(SUM(spent),0) spent FROM campaign_spend WHERE campaign_id=? AND date BETWEEN ? AND ?${sp.sql}`,
      [c.id, f.start, f.end, ...sp.args],
    );
    const revenue = one(
      `SELECT COALESCE(SUM(o.amount),0) revenue FROM dw_fact_orders o JOIN campaign_targets t ON t.id=o.campaign_target_id WHERE t.campaign_id=? AND t.targeted_at BETWEEN ? AND ? AND o.ordered_at BETWEEN ? AND ?${q.sql}`,
      [c.id, f.start, f.end, f.start, f.end, ...q.args],
    ).revenue;
    return {
      ...c,
      ...t,
      ...p,
      revenue,
      conversion: ratio(t.converted, t.target),
      progress: ratio(p.spent, p.planned),
      status: c.end_date < f.end ? "완료" : "진행 중",
    };
  });
}
function appMetrics(f, start = f.start, end = f.end) {
  const q = scope(f);
  const r = one(
    `SELECT COUNT(*) sessions,COUNT(DISTINCT customer_id) users,COALESCE(SUM(viewed_product),0) viewed,COALESCE(SUM(added_cart),0) cart,COUNT(order_id) purchased,COALESCE(AVG(duration_seconds),0) duration FROM app_sessions WHERE session_date BETWEEN ? AND ?${q.sql}`,
    [start, end, ...q.args],
  );
  const daily = all(
    `SELECT session_date date,COUNT(DISTINCT customer_id) users,COUNT(*) sessions FROM app_sessions WHERE session_date BETWEEN ? AND ?${q.sql} GROUP BY session_date`,
    [start, end, ...q.args],
  );
  return {
    ...r,
    duration: Math.round(r.duration),
    conversion: ratio(r.purchased, r.sessions),
    dailyAverage: Math.round(daily.reduce((s, r) => s + r.users, 0) / f.days),
    daily,
  };
}
export function analytics(f) {
  const q = scope(f);
  const current = summary(f),
    previous = summary(f, f.previousStart, f.previousEnd);
  const customers = customerMetrics(f),
    oldCustomers = customerMetrics(f, f.previousStart, f.previousEnd);
  const campaigns = campaignMetrics(f),
    oldCampaigns = campaignMetrics({
      ...f,
      start: f.previousStart,
      end: f.previousEnd,
    });
  const budget = all(
    `SELECT department,SUM(planned) planned,SUM(spent) spent,SUM(sales_target) salesTarget FROM budget_daily WHERE date BETWEEN ? AND ?${q.sql} GROUP BY department`,
    [f.start, f.end, ...q.args],
  );
  const totals = budget.reduce(
    (a, r) => ({
      planned: a.planned + r.planned,
      spent: a.spent + r.spent,
      salesTarget: a.salesTarget + r.salesTarget,
    }),
    { planned: 0, spent: 0, salesTarget: 0 },
  );
  const trends = all(
    `SELECT date,SUM(sales) sales,SUM(orders) orders FROM mart_sales_daily WHERE date BETWEEN ? AND ?${q.sql} GROUP BY date`,
    [f.previousStart, f.end, ...q.args],
  );
  const map = new Map(trends.map((r) => [r.date, r]));
  const trend = Array.from({ length: f.days }, (_, i) => {
    const date = dateAdd(f.start, i),
      prev = map.get(dateAdd(f.previousStart, i)),
      now = map.get(date);
    return {
      date,
      sales: now?.sales || 0,
      previous: prev?.sales || 0,
      orders: now?.orders || 0,
    };
  });
  const sq = scope(f, "o");
  const categories = all(
    `SELECT p.category,SUM(i.quantity*i.unit_price) sales,SUM(i.quantity) quantity FROM order_items i JOIN dw_fact_orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id WHERE o.ordered_at BETWEEN ? AND ?${sq.sql} GROUP BY p.category ORDER BY sales DESC`,
    [f.start, f.end, ...sq.args],
  );
  const byStore = all(
    `SELECT s.name,SUM(o.amount) sales,COUNT(*) orders FROM dw_fact_orders o JOIN stores s ON s.id=o.store_id WHERE o.ordered_at BETWEEN ? AND ?${sq.sql} GROUP BY s.id ORDER BY sales DESC`,
    [f.start, f.end, ...sq.args],
  );
  const app = appMetrics(f),
    previousApp = appMetrics(f, f.previousStart, f.previousEnd);
  const campaignTotal = (list) => {
    const r = list.reduce(
      (a, c) => ({
        target: a.target + c.target,
        converted: a.converted + c.converted,
        spent: a.spent + c.spent,
        planned: a.planned + c.planned,
        revenue: a.revenue + c.revenue,
      }),
      { target: 0, converted: 0, spent: 0, planned: 0, revenue: 0 },
    );
    return { ...r, conversion: ratio(r.converted, r.target) };
  };
  const ct = campaignTotal(campaigns),
    pct = campaignTotal(oldCampaigns);
  const salesChange = change(current.sales, previous.sales);
  const best = [...campaigns]
    .filter((c) => c.target > 0)
    .sort((a, b) => (b.conversion || 0) - (a.conversion || 0))[0];
  const insights = [
    {
      title: "매출 흐름",
      body: current.orders
        ? `선택 기간 완료 주문 ${current.orders.toLocaleString("ko-KR")}건, 매출 ${current.sales.toLocaleString("ko-KR")}원입니다. ${salesChange === null ? "비교 기간 매출이 없어 증감률을 계산할 수 없습니다." : `직전 동일 길이 기간 대비 ${Math.abs(salesChange)}% ${salesChange >= 0 ? "증가" : "감소"}했습니다.`}`
        : "선택한 기간·점포·채널에 완료 주문이 없습니다.",
    },
    {
      title: "캠페인 전환",
      body: best
        ? `${best.name} 캠페인의 대상 ${best.target}명 중 ${best.converted}명이 구매했습니다. 전환율은 ${best.conversion}%입니다.`
        : "선택 조건에 해당하는 캠페인 대상 고객이 없습니다.",
    },
    {
      title: "예산 집행",
      body: totals.planned
        ? `배정 예산 ${totals.planned.toLocaleString("ko-KR")}원 중 ${totals.spent.toLocaleString("ko-KR")}원을 사용했습니다. 잔여 예산은 ${(totals.planned - totals.spent).toLocaleString("ko-KR")}원입니다.`
        : "선택 조건에 등록된 예산이 없습니다.",
    },
  ];
  return {
    range: f,
    seed: one("SELECT * FROM seed_info"),
    queriedAt: new Date().toISOString(),
    summary: {
      ...current,
      averageOrder: current.orders
        ? Math.round(current.sales / current.orders)
        : 0,
      salesChange,
      customerChange: change(current.activeCustomers, previous.activeCustomers),
      orderChange: change(current.orders, previous.orders),
      averageChange: change(
        current.orders ? current.sales / current.orders : 0,
        previous.orders ? previous.sales / previous.orders : 0,
      ),
    },
    customers: {
      ...customers,
      totalChange: change(customers.total, oldCustomers.total),
      newChange: change(customers.new, oldCustomers.new),
      repurchaseChange:
        customers.repurchaseRate !== null &&
        oldCustomers.repurchaseRate !== null
          ? +(customers.repurchaseRate - oldCustomers.repurchaseRate).toFixed(2)
          : null,
    },
    sales: {
      trend,
      categories: categories.map((c) => ({
        ...c,
        share: ratio(c.sales, current.sales),
      })),
      byStore,
    },
    campaigns: {
      items: campaigns,
      ...ct,
      conversionChange:
        ct.conversion !== null && pct.conversion !== null
          ? +(ct.conversion - pct.conversion).toFixed(2)
          : null,
    },
    app: {
      ...app,
      userChange: change(app.users, previousApp.users),
      conversionChange:
        app.conversion !== null && previousApp.conversion !== null
          ? +(app.conversion - previousApp.conversion).toFixed(2)
          : null,
      daily: trend.map((t) => ({
        date: t.date,
        users: app.daily.find((d) => d.date === t.date)?.users || 0,
        sessions: app.daily.find((d) => d.date === t.date)?.sessions || 0,
      })),
    },
    budget: {
      ...totals,
      remaining: totals.planned - totals.spent,
      execution: ratio(totals.spent, totals.planned),
      achievement: ratio(current.sales, totals.salesTarget),
      departments: budget.map((b) => ({
        ...b,
        execution: ratio(b.spent, b.planned),
      })),
    },
    insights,
  };
}
export function catalog() {
  const seed = one("SELECT * FROM seed_info");
  const known = new Set(
    all("SELECT name FROM sqlite_master WHERE type IN ('table','view')").map(
      (r) => r.name,
    ),
  );
  return {
    assets: all("SELECT * FROM asset_metadata")
      .filter((a) => known.has(a.id))
      .map((a) => ({
        ...a,
        rows: one(`SELECT COUNT(*) count FROM "${a.id.replaceAll('"', '""')}"`)
          .count,
        columns: db
          .prepare("SELECT name,type,pk FROM pragma_table_info(?)")
          .all(a.id),
        updatedAt: seed.created_at,
      })),
    edges: all("SELECT source,target FROM asset_edges"),
    pipelines: all("SELECT * FROM pipeline_runs"),
    updatedAt: seed.created_at,
  };
}
export function orderList(f, params) {
  const page = Number(params.get("page") || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new Error("400:페이지 번호가 올바르지 않습니다.");
  const q = scope(f, "o");
  const search = (params.get("q") || "").trim().slice(0, 100);
  const searchSql = search
    ? " AND (CAST(o.id AS TEXT)=? OR c.name LIKE ?)"
    : "";
  const args = [
    f.start,
    f.end,
    ...q.args,
    ...(search ? [search, `%${search}%`] : []),
  ];
  const from = `FROM dw_fact_orders o JOIN customers c ON c.id=o.customer_id JOIN stores s ON s.id=o.store_id WHERE o.ordered_at BETWEEN ? AND ?${q.sql}${searchSql}`;
  return {
    page,
    pageSize: 20,
    total: one(`SELECT COUNT(*) total ${from}`, args).total,
    items: all(
      `SELECT o.id,c.name customer,c.grade,s.name store,o.channel,o.ordered_at date,o.amount,o.method ${from} ORDER BY o.ordered_at DESC,o.id DESC LIMIT 20 OFFSET ?`,
      [...args, (page - 1) * 20],
    ),
  };
}
