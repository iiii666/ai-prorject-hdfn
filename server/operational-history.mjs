// Add missing operational sample history once, without replacing existing transactions.
export function extendOperationalHistory(db) {
  if (
    db
      .prepare(
        "SELECT value FROM settings WHERE key='operationalHistoryVersion'",
      )
      .get()
  )
    return;
  const seed = db.prepare("SELECT * FROM seed_info").get();
  const end = db
    .prepare("SELECT value FROM settings WHERE key='operationalStart'")
    .get()?.value;
  if (!end || seed.start_date >= end) return;
  let state = 7349;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const add = (s) =>
    new Date(Date.parse(s + "T00:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db
        .prepare(
          "SELECT value FROM settings WHERE key='operationalHistoryVersion'",
        )
        .get()
    ) {
      db.exec("COMMIT");
      return;
    }
    let cid = db.prepare("SELECT MAX(id) n FROM campaigns").get().n,
      tid = db.prepare("SELECT MAX(id) n FROM campaign_targets").get().n,
      sid = db.prepare("SELECT MAX(id) n FROM app_sessions").get().n;
    const campaign = db.prepare("INSERT INTO campaigns VALUES (?,?,?,?,?)"),
      target = db.prepare("INSERT INTO campaign_targets VALUES (?,?,?,?,?,?)"),
      session = db.prepare(
        "INSERT INTO app_sessions (id,customer_id,store_id,session_date,duration_seconds,viewed_product,added_cart,order_id) VALUES (?,?,?,?,?,?,?,?)",
      );
    const spend = db.prepare("INSERT INTO campaign_spend VALUES (?,?,?,?,?,?)"),
      budget = db.prepare("INSERT INTO budget_daily VALUES (?,?,?,?,?,?,?)");
    const defs = new Map();
    let sessions = 0,
      targets = 0;
    const orders = db
      .prepare(
        "SELECT id,customer_id,store_id,channel,ordered_at FROM dw_fact_orders WHERE ordered_at>=? AND ordered_at<? ORDER BY ordered_at,id",
      )
      .all(seed.start_date, end);
    for (const o of orders) {
      const y = Number(o.ordered_at.slice(0, 4)),
        quarter = Math.floor((Number(o.ordered_at.slice(5, 7)) - 1) / 3),
        key = `${y}-${quarter}-${o.channel}`;
      if (!defs.has(key)) {
        const start = `${y}-${String(quarter * 3 + 1).padStart(2, "0")}-01`,
          stop = new Date(Date.UTC(y, quarter * 3 + 3, 0))
            .toISOString()
            .slice(0, 10);
        const c = { id: ++cid, start, end: stop, channel: o.channel };
        campaign.run(
          c.id,
          `${y} ${["봄맞이", "패밀리", "가을 재방문", "연말 감사"][quarter]} ${o.channel === "모바일 앱" ? "앱 쿠폰" : "점포 초대"}`,
          c.channel,
          start,
          stop,
        );
        defs.set(key, c);
      }
      if (o.channel === "모바일 앱") {
        session.run(
          ++sid,
          o.customer_id,
          o.store_id,
          o.ordered_at,
          120 + Math.floor(rand() * 600),
          1,
          1,
          o.id,
        );
        sessions++;
      }
    }
    const attribute = db.prepare(
      "UPDATE orders SET campaign_target_id=? WHERE id=? AND campaign_target_id IS NULL",
    );
    for (const c of defs.values()) {
      const assigned = new Map();
      for (const o of orders.filter(
        (o) =>
          o.channel === c.channel &&
          o.ordered_at >= c.start &&
          o.ordered_at <= c.end,
      )) {
        if (!assigned.has(o.customer_id) && rand() < 0.3) {
          const t = { id: ++tid, store: o.store_id };
          target.run(t.id, c.id, o.customer_id, t.store, c.channel, c.start);
          assigned.set(o.customer_id, t);
          targets++;
        }
        const t = assigned.get(o.customer_id);
        if (t && t.store === o.store_id && rand() < 0.5)
          attribute.run(t.id, o.id);
      }
      // Non-converting targets keep the conversion rate from trivially becoming 100%.
      for (let u = 1; u <= 2400; u++)
        if (!assigned.has(u) && rand() < 0.32) {
          target.run(
            ++tid,
            c.id,
            u,
            1 + Math.floor(rand() * 3),
            c.channel,
            c.start,
          );
          targets++;
        }
    }
    const cList = [...defs.values()];
    for (let date = seed.start_date; date < end; date = add(date))
      for (let store = 1; store <= 3; store++) {
        for (let j = 0; j < 32; j++) {
          const view = rand() < 0.76 ? 1 : 0;
          session.run(
            ++sid,
            1 + Math.floor(rand() * 2400),
            store,
            date,
            20 + Math.floor(rand() * 480),
            view,
            view && rand() < 0.3 ? 1 : 0,
            null,
          );
          sessions++;
        }
        for (const channel of ["모바일 앱", "오프라인"]) {
          let planned = 0,
            spent = 0;
          for (const c of cList.filter(
            (c) => c.channel === channel && c.start <= date && c.end >= date,
          )) {
            const p = 60000 + Math.floor(rand() * 60000),
              v = Math.round(p * (0.5 + rand() * 0.4));
            spend.run(c.id, store, channel, date, p, v);
            planned += p;
            spent += v;
          }
          budget.run(
            date,
            store,
            channel,
            "CRM 캠페인",
            planned,
            spent,
            400000,
          );
          for (const name of ["디지털 마케팅", "점포 프로모션"]) {
            const p = 100000 + Math.floor(rand() * 60000);
            budget.run(
              date,
              store,
              channel,
              name,
              p,
              Math.round(p * (0.5 + rand() * 0.35)),
              650000,
            );
          }
        }
      }
    db.prepare(
      "INSERT INTO settings VALUES ('operationalHistoryVersion','1')",
    ).run();
    db.prepare("UPDATE settings SET value=? WHERE key='operationalStart'").run(
      seed.start_date,
    );
    db.prepare(
      "UPDATE pipeline_runs SET processed_rows=processed_rows+?,finished_at=? WHERE id=3",
    ).run(sessions, new Date().toISOString());
    db.prepare(
      "UPDATE pipeline_runs SET processed_rows=processed_rows+?,finished_at=? WHERE id=4",
    ).run(targets, new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
