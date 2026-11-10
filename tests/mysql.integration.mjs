import test, { after } from "node:test";
import assert from "node:assert/strict";
if (process.env.DW_TEST_SQLITE === "1")
  throw Error("MySQL integration tests require a real MySQL server");
process.env.PORT = "0";
const { initialize, all, one, close, transaction, databaseEngine } =
  await import("../server/db.mjs");
await initialize();
const { analytics, filters, catalog, orderList } =
  await import("../server/analytics.mjs");
const { forecast, customStatus, customAnalysis } =
  await import("../server/custom.mjs");
const { server } = await import("../server/index.mjs");
if (!server.listening)
  await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await close();
});
test("real MySQL 8.4 is used and InnoDB enforces foreign keys", async () => {
  assert.equal(databaseEngine, "MySQL");
  assert.match((await one("SELECT VERSION() version")).version, /^8\.4\./);
  assert.ok(
    (
      await one(
        "SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()",
      )
    ).n > 15,
  );
  await assert.rejects(
    transaction((tx) =>
      tx.run(
        "INSERT INTO orders VALUES (987654321,-1,1,'오프라인','2026-11-10','completed',NULL)",
      ),
    ),
    (e) => e.code === "ER_NO_REFERENCED_ROW_2",
  );
});
test("all analytics queries execute in strict MySQL and reconcile to raw payments", async () => {
  const f = await filters(new URLSearchParams()),
    d = await analytics(f);
  const raw = await one(
    "SELECT SUM(amount) sales,COUNT(*) orders FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?",
    [f.start, f.end],
  );
  assert.equal(d.summary.sales, raw.sales);
  assert.equal(d.summary.orders, raw.orders);
  assert.equal(typeof d.summary.sales, "number");
  for (const list of [d.sales.trend, d.sales.categories, d.sales.byStore])
    assert.equal(
      list.reduce((s, r) => s + r.sales, 0),
      raw.sales,
    );
  assert.equal(d.customers.active, d.summary.activeCustomers);
  assert.equal(
    d.campaigns.spent,
    d.budget.departments.find((b) => b.department === "CRM 캠페인").spent,
  );
  assert.ok(
    d.app.sessions >= d.app.viewed &&
      d.app.viewed >= d.app.cart &&
      d.app.cart >= d.app.purchased,
  );
  const mobile = await analytics(
    await filters(new URLSearchParams("channel=모바일 앱")),
  );
  assert.equal(d.app.purchased, mobile.summary.orders);
  const offline = await analytics(
    await filters(new URLSearchParams("channel=오프라인")),
  );
  assert.equal(offline.app.sessions, 0);
  assert.equal(mobile.summary.sales + offline.summary.sales, d.summary.sales);
});
test("catalog reads real MySQL metadata and row counts", async () => {
  const c = await catalog();
  assert.equal(c.assets.length, 16);
  const orders = c.assets.find((a) => a.id === "orders");
  assert.ok(orders.columns.some((c) => c.name === "id" && c.pk === 1));
  assert.equal(orders.rows, (await one("SELECT COUNT(*) n FROM orders")).n);
  assert.equal(
    c.assets.find((a) => a.id === "dw_fact_orders").rows,
    (await one("SELECT COUNT(*) n FROM payments")).n,
  );
});
test("MySQL custom evidence, filters, history and forecasts reconcile", async () => {
  const year = (await customStatus()).years[0];
  const e = await forecast({ year });
  for (const list of [
    e.breakdown.byStore,
    e.breakdown.byChannel,
    e.breakdown.byCategory,
    e.breakdown.byGrade,
    e.breakdown.monthlyByStore,
  ])
    assert.equal(
      list.reduce((s, r) => s + r.sales, 0),
      e.actualTotal,
    );
  let sum = 0;
  for (const store of ["1", "2", "3"])
    sum += (await forecast({ year, store })).actualTotal;
  assert.equal(sum, e.actualTotal);
  assert.equal(
    e.baselineTotal,
    e.monthly.reduce((s, r) => s + r.baseline, 0),
  );
  assert.equal(
    (await forecast({ year, uplift: 0 })).eventTotal,
    e.baselineTotal,
  );
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "integration-test-placeholder";
  try {
    let calls = 0;
    const r = await customAnalysis(
      { question: "매출이 가장 높은 점포를 분석해 줘", year },
      {
        call: async (system, data) => {
          calls++;
          if (calls === 1) return { allowed: true };
          assert.equal(data.evidence.breakdown.byStore.length, 3);
          return {
            summary: "MySQL 집계 근거입니다.",
            findings: [],
            events: [],
            cautions: [],
          };
        },
      },
    );
    assert.equal(r.evidence.actualTotal, e.actualTotal);
  } finally {
    if (key) process.env.OPENAI_API_KEY = key;
    else delete process.env.OPENAI_API_KEY;
  }
});
test("search pagination, empty results and HTTP settings transactions work in MySQL", async () => {
  const f = await filters(new URLSearchParams());
  const page = await orderList(f, new URLSearchParams("page=1"));
  assert.equal(page.items.length, 20);
  assert.equal(
    (await orderList(f, new URLSearchParams("q=" + page.items[0].id))).items
      .length,
    1,
  );
  const empty = await analytics(
    await filters(new URLSearchParams("start=2020-01-01&end=2020-01-07")),
  );
  assert.equal(empty.summary.sales, 0);
  assert.equal(empty.budget.execution, null);
  const original = (await (await fetch(base + "/api/bootstrap")).json())
    .settings;
  try {
    const r = await fetch(base + "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceName: "MySQL 설정 저장 검증",
        alertsEnabled: false,
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(
      (await one("SELECT value FROM settings WHERE key='workspaceName'")).value,
      "MySQL 설정 저장 검증",
    );
  } finally {
    await fetch(base + "/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(original),
    });
  }
  assert.equal(
    (await (await fetch(base + "/api/health")).json()).database,
    "MySQL",
  );
  const csv = await fetch(base + "/api/export");
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes("매출(원)"));
});
test("initialization is idempotent and preserves existing data", async () => {
  const before = await one("SELECT COUNT(*) n FROM orders");
  await initialize();
  assert.equal((await one("SELECT COUNT(*) n FROM orders")).n, before.n);
});
