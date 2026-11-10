// Idempotent, additive extension of generated sample history; existing orders are preserved.
export function extendHistory(db) {
  if (db.prepare("SELECT value FROM settings WHERE key='historyVersion'").get())
    return;
  const seed = db.prepare("SELECT * FROM seed_info").get(),
    start = `${Number(seed.end_date.slice(0, 4)) - 2}-01-01`;
  if (start >= seed.start_date) return;
  let state = 4291;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const add = (s, n) =>
    new Date(Date.parse(s + "T00:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db.prepare("SELECT value FROM settings WHERE key='historyVersion'").get()
    ) {
      db.exec("COMMIT");
      return;
    }
    db.prepare(
      "UPDATE customers SET joined_at=? WHERE id<=2400 AND joined_at>?",
    ).run(start, start);
    let oid = db.prepare("SELECT MAX(id) n FROM orders").get().n,
      iid = db.prepare("SELECT MAX(id) n FROM order_items").get().n;
    const order = db.prepare(
        "INSERT INTO orders VALUES (?,?,?,?,?,'completed',NULL)",
      ),
      item = db.prepare("INSERT INTO order_items VALUES (?,?,?,?,?)"),
      payment = db.prepare("INSERT INTO payments VALUES (?,?,?,?,?)");
    const products = db.prepare("SELECT id,price FROM products").all();
    let count = 0;
    for (let date = start; date < seed.start_date; date = add(date, 1)) {
      const month = Number(date.slice(5, 7)),
        season = [
          0.85, 0.95, 1.05, 1, 1.12, 0.9, 0.85, 0.92, 1.18, 1.1, 1.3, 1.45,
        ][month - 1],
        trend = 1 + (Date.parse(date) - Date.parse(start)) / 86400000 / 3000;
      for (
        let j = 0, n = Math.round((48 + rnd() * 25) * season * trend);
        j < n;
        j++
      ) {
        const customer = 1 + Math.floor(rnd() * 2400),
          store = 1 + Math.floor(rnd() * 3),
          channel = rnd() < 0.58 ? "모바일 앱" : "오프라인";
        order.run(++oid, customer, store, channel, date);
        let amount = 0;
        for (let k = 0, n = 1 + Math.floor(rnd() * 2); k < n; k++) {
          const p = products[Math.floor(rnd() * products.length)],
            qty = 1 + Math.floor(rnd() * 2);
          item.run(++iid, oid, p.id, qty, p.price);
          amount += qty * p.price;
        }
        payment.run(oid, oid, amount, "신용카드", date);
        count++;
      }
    }
    // Historical sales only: app, budget and campaign data retain their original coverage.
    db.prepare("UPDATE seed_info SET start_date=? WHERE id=1").run(start);
    db.prepare("INSERT INTO settings VALUES ('historyVersion','1')").run();
    db.prepare("INSERT INTO settings VALUES ('operationalStart',?)").run(
      seed.start_date,
    );
    db.prepare(
      "UPDATE pipeline_runs SET processed_rows=processed_rows+? WHERE id=2",
    ).run(count);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
