import { all, one } from "./db.mjs";
const percent = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);
export function buildEvidence({
  year,
  store,
  channel,
  total,
  coverageStart,
  coverageEnd,
}) {
  const start = `${year}-01-01`,
    end = `${year}-12-31` < coverageEnd ? `${year}-12-31` : coverageEnd;
  const scope = (prefix = "") =>
    `${store ? ` AND ${prefix}store_id=?` : ""}${channel ? ` AND ${prefix}channel=?` : ""}`;
  const args = [
    start,
    end,
    ...(store ? [Number(store)] : []),
    ...(channel ? [channel] : []),
  ];
  const priorEnd = `${year - 1}` + end.slice(4);
  const previousArgs = [`${year - 1}-01-01`, priorEnd, ...args.slice(2)];
  const enriched = (rows) =>
    rows.map((r) => ({
      ...r,
      share: percent(r.sales, total),
      averageOrder: r.orders ? Math.round(r.sales / r.orders) : 0,
    }));
  const previous = all(
    `SELECT store_id,SUM(amount) sales FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?${scope()} GROUP BY store_id`,
    previousArgs,
  );
  const byStore = enriched(
    all(
      `SELECT s.id storeId,s.name storeName,SUM(o.amount) sales,COUNT(*) orders,COUNT(DISTINCT o.customer_id) customers FROM dw_fact_orders o JOIN stores s ON s.id=o.store_id WHERE o.ordered_at BETWEEN ? AND ?${scope("o.")} GROUP BY s.id ORDER BY sales DESC,s.id`,
      args,
    ),
  ).map((r, i) => {
    const p = previous.find((v) => v.store_id === r.storeId)?.sales || 0;
    return {
      ...r,
      rank: i + 1,
      previousSales: p,
      change: p ? Math.round(((r.sales - p) / p) * 10000) / 100 : null,
    };
  });
  const byChannel = enriched(
    all(
      `SELECT channel,SUM(amount) sales,COUNT(*) orders,COUNT(DISTINCT customer_id) customers FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?${scope()} GROUP BY channel ORDER BY sales DESC`,
      args,
    ),
  );
  const byCategory = enriched(
    all(
      `SELECT p.category,SUM(i.quantity*i.unit_price) sales,COUNT(DISTINCT o.id) orders,SUM(i.quantity) quantity FROM order_items i JOIN dw_fact_orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id WHERE o.ordered_at BETWEEN ? AND ?${scope("o.")} GROUP BY p.category ORDER BY sales DESC`,
      args,
    ),
  );
  const monthlyByStore = all(
    `SELECT substr(o.ordered_at,1,7) month,s.id storeId,s.name storeName,SUM(o.amount) sales,COUNT(*) orders FROM dw_fact_orders o JOIN stores s ON s.id=o.store_id WHERE o.ordered_at BETWEEN ? AND ?${scope("o.")} GROUP BY month,s.id ORDER BY month,s.id`,
    args,
  );
  const monthlyByCategory = all(
    `SELECT substr(o.ordered_at,1,7) month,p.category,SUM(i.quantity*i.unit_price) sales FROM order_items i JOIN dw_fact_orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id WHERE o.ordered_at BETWEEN ? AND ?${scope("o.")} GROUP BY month,p.category ORDER BY month,p.category`,
    args,
  );
  const byGrade = enriched(
    all(
      `SELECT c.grade,SUM(o.amount) sales,COUNT(*) orders,COUNT(DISTINCT c.id) customers FROM dw_fact_orders o JOIN customers c ON c.id=o.customer_id WHERE o.ordered_at BETWEEN ? AND ?${scope("o.")} GROUP BY c.grade ORDER BY sales DESC`,
      args,
    ),
  );
  const budgetByStore = all(
    `SELECT s.id storeId,s.name storeName,SUM(b.planned) planned,SUM(b.spent) spent,SUM(b.sales_target) salesTarget FROM budget_daily b JOIN stores s ON s.id=b.store_id WHERE b.date BETWEEN ? AND ?${scope("b.")} GROUP BY s.id`,
    args,
  );
  const byDepartment = all(
    `SELECT department,SUM(planned) planned,SUM(spent) spent,SUM(sales_target) salesTarget FROM budget_daily WHERE date BETWEEN ? AND ?${scope()} GROUP BY department`,
    args,
  );
  const campaignDetails = all(
    `SELECT c.id,c.name,c.channel,c.start_date startDate,c.end_date endDate,COUNT(DISTINCT t.id) target,COUNT(DISTINCT CASE WHEN o.id IS NOT NULL THEN t.id END) converted,COALESCE(SUM(o.amount),0) revenue FROM campaigns c JOIN campaign_targets t ON t.campaign_id=c.id LEFT JOIN dw_fact_orders o ON o.campaign_target_id=t.id AND o.ordered_at BETWEEN ? AND ? WHERE t.targeted_at BETWEEN ? AND ?${scope("t.")} GROUP BY c.id ORDER BY revenue DESC`,
    [start, end, ...args],
  );
  const campaigns = campaignDetails.map((c) => {
    const cost = one(
      `SELECT COALESCE(SUM(planned),0) planned,COALESCE(SUM(spent),0) spent FROM campaign_spend WHERE campaign_id=? AND date BETWEEN ? AND ?${scope()}`,
      [c.id, ...args],
    );
    return {
      ...c,
      ...cost,
      conversion: percent(c.converted, c.target),
      revenuePerSpend: cost.spent
        ? Math.round((c.revenue / cost.spent) * 100) / 100
        : null,
    };
  });
  const appByStore = all(
    `SELECT s.id storeId,s.name storeName,COUNT(*) sessions,COUNT(DISTINCT a.customer_id) users,COUNT(a.order_id) purchases,ROUND(AVG(a.duration_seconds)) averageDuration FROM app_sessions a JOIN stores s ON s.id=a.store_id WHERE a.session_date BETWEEN ? AND ?${scope("a.")} GROUP BY s.id`,
    args,
  );
  const sources = {
    actual: {
      table: "dw_fact_orders + order_items",
      start: start > coverageStart ? start : coverageStart,
      end,
      definition:
        "보유 기간 완료 주문 결제액 합계. 일평균으로 생성한 예측 금액이 아님.",
    },
    previous: {
      start: `${year - 1}-01-01`,
      end: priorEnd,
      definition: "전년도 동일 종료 월일 기준. 보유 기간 이전은 미보유.",
    },
    budget: {
      table: "budget_daily",
      start,
      end,
      definition:
        "매출 실적과 같은 연도·점포·채널·종료일 범위의 목표/예산 합계",
    },
    campaigns: {
      table: "campaign_targets + orders + campaign_spend",
      definition:
        "기간 내 대상 지정과 같은 기간 귀속 완료 주문. 전환은 고유 대상 고객 수. 기여 매출은 인과 효과 아님.",
    },
  };
  return {
    byStore,
    byChannel,
    byCategory,
    monthlyByStore,
    monthlyByCategory,
    byGrade,
    budgetByStore,
    byDepartment,
    campaigns,
    appByStore,
    sources,
    verifiedFacts: {
      topStore: byStore[0] || null,
      topCategory: byCategory[0] || null,
      topChannel: byChannel[0] || null,
      bestCampaign:
        [...campaigns]
          .filter((c) => c.target)
          .sort((a, b) => b.conversion - a.conversion || a.id - b.id)[0] ||
        null,
    },
    dataAvailability: {
      storeSales: byStore.length > 0,
      channelSales: byChannel.length > 0,
      categorySales: byCategory.length > 0,
      customerGrades: byGrade.length > 0,
      budget: budgetByStore.length > 0,
      campaigns: campaigns.length > 0,
      appSessions: appByStore.length > 0,
    },
  };
}
