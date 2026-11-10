import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
process.env.DW_DB_PATH = ":memory:";
process.env.DW_SEED_END = "2026-11-09";
process.env.PORT = "0";
const { db, one, all, seed } = await import("../server/db.mjs");
const { analytics, filters, catalog, orderList } =
  await import("../server/analytics.mjs");
const { server } = await import("../server/index.mjs");
if (!server.listening) await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}`;
const f = async (query = "") => await filters(new URLSearchParams(query));
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
test("seed is idempotent, relationally valid, and every payment equals its order items", async () => {
  const before = (await one("SELECT COUNT(*) n FROM orders")).n;
  await seed();
  assert.equal((await one("SELECT COUNT(*) n FROM orders")).n, before);
  assert.ok(before > 30000);
  assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM payments p JOIN (SELECT order_id,SUM(quantity*unit_price) total FROM order_items GROUP BY order_id) i ON i.order_id=p.order_id WHERE p.amount<>i.total",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM orders o JOIN customers c ON c.id=o.customer_id WHERE c.joined_at>o.ordered_at",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE (o.status='completed' AND p.id IS NULL) OR (o.status='cancelled' AND p.id IS NOT NULL)",
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "SELECT COUNT(*) n FROM app_sessions a JOIN orders o ON o.id=a.order_id WHERE a.customer_id<>o.customer_id OR a.store_id<>o.store_id OR a.session_date<>o.ordered_at OR o.channel<>a.channel",
      )
    ).n,
    0,
  );
});
test("overview, trends, category and store totals reconcile to raw payments", async () => {
  const d = await analytics(await f());
  const raw = await one(
    "SELECT SUM(p.amount) amount,COUNT(*) orders,COUNT(DISTINCT o.customer_id) customers FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.status='completed' AND o.ordered_at BETWEEN ? AND ?",
    [d.range.start, d.range.end],
  );
  assert.equal(d.summary.sales, raw.amount);
  assert.equal(d.summary.orders, raw.orders);
  assert.equal(d.summary.activeCustomers, raw.customers);
  for (const rows of [d.sales.trend, d.sales.categories, d.sales.byStore])
    assert.equal(
      rows.reduce((a, r) => a + r.sales, 0),
      raw.amount,
    );
  assert.equal(
    d.sales.trend.reduce((s, r) => s + r.orders, 0),
    raw.orders,
  );
  assert.equal(
    d.customers.grades.reduce((s, r) => s + r.count, 0),
    d.customers.total,
  );
  assert.equal(d.customers.active, d.summary.activeCustomers);
});
test("store, channel, date and prior-period filters query distinct underlying records", async () => {
  const global = await analytics(await f());
  let sum = 0;
  for (const store of [1, 2, 3]) {
    const d = await analytics(await f(`store=${store}`));
    sum += d.summary.sales;
    assert.ok(d.summary.sales < global.summary.sales);
  }
  assert.equal(sum, global.summary.sales);
  const app = await analytics(await f("channel=모바일 앱")),
    offline = await analytics(await f("channel=오프라인"));
  assert.equal(app.summary.sales + offline.summary.sales, global.summary.sales);
  assert.equal(offline.app.sessions, 0);
  const custom = await analytics(
    await f("start=2026-10-01&end=2026-10-07&store=2&channel=오프라인"),
  );
  const raw = await one(
    "SELECT SUM(p.amount) sales FROM orders o JOIN payments p ON p.order_id=o.id WHERE o.store_id=2 AND o.channel='오프라인' AND o.ordered_at BETWEEN '2026-10-01' AND '2026-10-07'",
  );
  assert.equal(custom.summary.sales, raw.sales);
  assert.equal(custom.range.previousStart, "2026-09-24");
  assert.equal(custom.range.previousEnd, "2026-09-30");
  assert.equal(custom.sales.trend.length, 7);
});
test("campaign attribution, weighted conversion and CRM budget reconcile", async () => {
  for (const params of [
    "",
    "store=1&channel=모바일 앱&days=7",
    "store=3&channel=오프라인&days=90",
  ]) {
    const d = await analytics(await f(params));
    assert.equal(
      d.campaigns.spent,
      d.budget.departments.find((b) => b.department === "CRM 캠페인").spent,
    );
    assert.equal(
      d.campaigns.planned,
      d.budget.departments.find((b) => b.department === "CRM 캠페인").planned,
    );
    assert.equal(d.budget.planned - d.budget.spent, d.budget.remaining);
    assert.ok(d.campaigns.converted <= d.campaigns.target);
    assert.equal(
      d.campaigns.target,
      d.campaigns.items.reduce((s, c) => s + c.target, 0),
    );
    assert.equal(
      d.campaigns.conversion,
      d.campaigns.target
        ? +((d.campaigns.converted / d.campaigns.target) * 100).toFixed(2)
        : null,
    );
  }
});
test("session funnel is ordered and conversions reconcile to mobile purchases", async () => {
  const d = await analytics(await f());
  assert.ok(
    d.app.sessions >= d.app.viewed &&
      d.app.viewed >= d.app.cart &&
      d.app.cart >= d.app.purchased,
  );
  assert.equal(
    d.app.purchased,
    (await analytics(await f("channel=모바일 앱"))).summary.orders,
  );
});
test("empty data returns zeros and undefined rates rather than generated values", async () => {
  const d = await analytics(await f("start=2020-01-01&end=2020-01-07"));
  assert.equal(d.summary.sales, 0);
  assert.equal(d.summary.orders, 0);
  assert.equal(d.summary.salesChange, null);
  assert.equal(d.app.sessions, 0);
  assert.equal(d.app.conversion, null);
  assert.equal(d.budget.planned, 0);
  assert.equal(d.budget.execution, null);
  assert.equal(d.campaigns.items.length, 0);
  assert.ok(d.sales.trend.every((r) => r.sales === 0));
  assert.equal(d.customers.total, 0);
});
test("new persisted transaction changes queries, categories and actual catalog counts", async () => {
  const before = await analytics(await f()),
    count = (await catalog()).assets.find((a) => a.id === "orders").rows;
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO orders VALUES (999999,1,1,'오프라인','2026-11-09','completed',NULL)",
    ).run();
    db.prepare(
      "INSERT INTO order_items VALUES (999999,999999,1,2,12345)",
    ).run();
    db.prepare(
      "INSERT INTO payments VALUES (999999,999999,24690,'신용카드','2026-11-09')",
    ).run();
    const next = await analytics(await f());
    assert.equal(next.summary.sales, before.summary.sales + 24690);
    assert.equal(next.summary.orders, before.summary.orders + 1);
    assert.equal(
      next.sales.categories.reduce((s, c) => s + c.sales, 0),
      next.summary.sales,
    );
    assert.equal(
      (await catalog()).assets.find((a) => a.id === "orders").rows,
      count + 1,
    );
  } finally {
    db.exec("ROLLBACK");
  }
});
test("catalog columns, rows and SQL dependency edges correspond to database objects", async () => {
  const c = await catalog();
  assert.equal(c.assets.length, 16);
  for (const a of c.assets) {
    assert.ok(a.columns.length > 0);
    assert.equal(a.rows, (await one(`SELECT COUNT(*) n FROM "${a.id}"`)).n);
  }
  for (const e of c.edges) {
    const sql = (
      await one("SELECT sql FROM sqlite_master WHERE name=?", [e.target])
    ).sql;
    assert.ok(sql.includes(e.source));
  }
  assert.equal(c.pipelines.length, 4);
});
test("order search and pagination preserve filtered totals without duplicate pages", async () => {
  const a = await orderList(await f("store=2"), new URLSearchParams("page=1")),
    b = await orderList(await f("store=2"), new URLSearchParams("page=2"));
  assert.equal(a.total, b.total);
  assert.equal(a.items.length, 20);
  assert.equal(new Set([...a.items, ...b.items].map((o) => o.id)).size, 40);
  const found = await orderList(
    await f("store=2"),
    new URLSearchParams(`q=${a.items[0].id}`),
  );
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].id, a.items[0].id);
});
test("HTTP validation, exports and database settings persistence", async () => {
  for (const query of [
    "end=wrong",
    "start=2026-02-30&end=2026-03-01",
    "store=99",
    "channel=invalid",
    "days=-1",
    "start=2020-01-01&end=2026-01-01",
    "start=2026-11-10&end=2026-11-01",
  ]) {
    const r = await fetch(`${url}/api/analytics?${query}`);
    assert.equal(r.status, 400, query);
    assert.ok((await r.json()).error);
  }
  let r = await fetch(`${url}/api/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceName: "테스트 DW",
      alertsEnabled: false,
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(
    (await one("SELECT value FROM settings WHERE key='workspaceName'")).value,
    "테스트 DW",
  );
  r = await fetch(`${url}/api/bootstrap`);
  assert.equal((await r.json()).settings.alertsEnabled, false);
  for (const body of [
    "null",
    "{}",
    '{"workspaceName":" ","alertsEnabled":true}',
  ]) {
    r = await fetch(`${url}/api/settings`, {
      method: "PATCH",
      body,
    });
    assert.equal(r.status, 400);
  }
  r = await fetch(`${url}/api/export?store=1&days=7`);
  const csv = await r.text();
  assert.equal(r.status, 200);
  assert.ok(
    csv.includes(
      String((await analytics(await f("store=1&days=7"))).summary.sales),
    ),
  );
  assert.ok(r.headers.get("content-disposition").includes(".csv"));
  assert.equal((await fetch(`${url}/api/missing`)).status, 404);
});
test("static root accepts a normalized build path", async () => {
  const r = await fetch(url + "/");
  assert.ok([200, 404].includes(r.status));
  if (r.status === 200) assert.ok((await r.text()).includes('id="root"'));
});
test("Vite proxy preserves same-origin requests and rejects unrelated origins", async () => {
  const { createServer } = await import("vite");
  const { default: config } = await import("../vite.config.ts");
  const proxyConfig = config.server.proxy["/api"];
  assert.equal(proxyConfig.changeOrigin, false);
  const vite = await createServer({
    ...config,
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: "127.0.0.1",
      port: 0,
      warmup: { clientFiles: [] },
      proxy: {
        "/api": {
          ...proxyConfig,
          target: url,
        },
      },
    },
  });
  await vite.listen();
  try {
    const { request } = await import("node:http");
    const port = vite.httpServer.address().port;
    const send = (host, origin) =>
      new Promise((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/custom/analyze",
            method: "POST",
            headers: {
              host,
              origin,
              "Content-Type": "application/json",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                body,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(
          JSON.stringify({
            question: "매출",
          }),
        );
      });
    for (const hostname of ["127.0.0.1", "localhost"]) {
      const host = `${hostname}:${port}`;
      const allowed = await send(host, `http://${host}`);
      assert.equal(allowed.status, 400, allowed.body); // Reached input validation, no paid model call.
      assert.ok(!allowed.body.includes("같은 사이트"));
      const denied = await send(host, "https://unrelated.example");
      assert.equal(denied.status, 403);
    }
  } finally {
    await vite.close();
  }
});
