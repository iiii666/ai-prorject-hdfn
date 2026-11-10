import test from "node:test";
import assert from "node:assert/strict";
process.env.DW_DB_PATH = ":memory:";
process.env.DW_SEED_END = "2026-11-10";
const { forecast } = await import("../server/custom.mjs");
const { one, all, db } = await import("../server/db.mjs");
const { extendOperationalHistory } =
  await import("../server/operational-history.mjs");
test("store/channel/category/grade/monthly totals reconcile with completed payments", async () => {
  for (const options of [
    {
      year: 2026,
    },
    {
      year: 2025,
    },
    {
      year: 2024,
    },
    {
      year: 2026,
      store: "2",
      channel: "모바일 앱",
    },
  ]) {
    const e = await forecast(options),
      b = e.breakdown;
    for (const rows of [
      b.byStore,
      b.byChannel,
      b.byCategory,
      b.byGrade,
      b.monthlyByStore,
      b.monthlyByCategory,
    ])
      assert.equal(
        rows.reduce((s, r) => s + r.sales, 0),
        e.actualTotal,
      );
    assert.equal(b.verifiedFacts.topStore.storeId, b.byStore[0].storeId);
    assert.ok(b.byStore.every((r, i, a) => !i || a[i - 1].sales >= r.sales));
    assert.ok(Object.values(b.dataAvailability).every(Boolean));
    assert.equal(
      b.budgetByStore.reduce((s, r) => s + r.salesTarget, 0),
      e.budgetSummary.salesTarget,
    );
    assert.equal(
      b.byDepartment.reduce((s, r) => s + r.spent, 0),
      e.budgetSummary.spent,
    );
    assert.equal(
      b.appByStore.reduce((s, r) => s + r.sessions, 0),
      e.appSummary.sessions,
    );
    assert.ok(
      b.campaigns.every((c) => c.converted <= c.target && c.spent >= 0),
    );
  }
});
test("store winner is determined from SQL, previous comparison uses same cutoff", async () => {
  const e = await forecast({
      year: 2026,
    }),
    top = e.breakdown.verifiedFacts.topStore;
  const raw = await one(
    "SELECT s.id,SUM(p.amount) sales FROM orders o JOIN payments p ON p.order_id=o.id JOIN stores s ON s.id=o.store_id WHERE o.status='completed' AND o.ordered_at BETWEEN '2026-01-01' AND '2026-11-10' GROUP BY s.id ORDER BY sales DESC,s.id LIMIT 1",
  );
  assert.equal(top.storeId, raw.id);
  assert.equal(top.sales, raw.sales);
  assert.equal(e.breakdown.sources.previous.end, "2025-11-10");
  assert.equal(
    e.breakdown.sources.actual.definition.includes("예측 금액이 아님"),
    true,
  );
});
test("historical operational fill is idempotent, FK-valid and covers each year", async () => {
  const tables = [
    "orders",
    "payments",
    "app_sessions",
    "campaigns",
    "campaign_targets",
    "budget_daily",
    "campaign_spend",
  ];
  const counts = async () =>
    await Promise.all(
      tables.map(async (t) => (await one(`SELECT COUNT(*) n FROM ${t}`)).n),
    );
  const before = await counts();
  extendOperationalHistory(db);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
  for (const year of [2024, 2025, 2026]) {
    const params = [String(year)];
    assert.ok(
      (
        await one(
          "SELECT COUNT(*) n FROM app_sessions WHERE substr(session_date,1,4)=?",
          params,
        )
      ).n > 1000,
    );
    assert.ok(
      (
        await one(
          "SELECT COUNT(*) n FROM budget_daily WHERE substr(date,1,4)=?",
          params,
        )
      ).n > 1000,
    );
    assert.ok(
      (
        await one(
          "SELECT COUNT(*) n FROM campaign_targets WHERE substr(targeted_at,1,4)=?",
          params,
        )
      ).n > 1000,
    );
  }
  const bad = await one(
    "SELECT COUNT(*) n FROM app_sessions a JOIN orders o ON o.id=a.order_id WHERE a.customer_id<>o.customer_id OR a.store_id<>o.store_id OR a.session_date<>o.ordered_at OR o.channel<>'모바일 앱'",
  );
  assert.equal(bad.n, 0);
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.ordered_at<c.joined_at",
      )
    ).n,
    0,
  );
});
test("historical campaign spend reconciles to CRM budgets and conversions reference same customer/store/channel", async () => {
  for (const year of [2024, 2025, 2026]) {
    const params = [String(year)];
    assert.equal(
      (
        await one(
          "SELECT SUM(spent) n FROM campaign_spend WHERE substr(date,1,4)=?",
          params,
        )
      ).n,
      (
        await one(
          "SELECT SUM(spent) n FROM budget_daily WHERE department='CRM 캠페인' AND substr(date,1,4)=?",
          params,
        )
      ).n,
    );
  }
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM orders o JOIN campaign_targets t ON t.id=o.campaign_target_id WHERE o.customer_id<>t.customer_id OR o.store_id<>t.store_id OR o.channel<>t.channel OR o.ordered_at<t.targeted_at",
      )
    ).n,
    0,
  );
});
test("read-only evidence is refreshed when a persisted sale changes", async () => {
  const before = await forecast({
    year: 2026,
  });
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO orders VALUES (999999,1,1,'오프라인','2026-11-10','completed',NULL)",
    ).run();
    db.prepare(
      "INSERT INTO order_items VALUES (999999,999999,1,1,12345)",
    ).run();
    db.prepare(
      "INSERT INTO payments VALUES (999999,999999,12345,'신용카드','2026-11-10')",
    ).run();
    const after = await forecast({
      year: 2026,
    });
    assert.equal(after.actualTotal, before.actualTotal + 12345);
    assert.equal(
      after.breakdown.byStore.find((s) => s.storeId === 1).sales,
      before.breakdown.byStore.find((s) => s.storeId === 1).sales + 12345,
    );
  } finally {
    db.exec("ROLLBACK");
  }
});
