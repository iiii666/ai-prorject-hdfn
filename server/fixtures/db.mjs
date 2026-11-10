import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
export const dbPath = ":memory:";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
);
db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
export const all = (sql, params = []) => db.prepare(sql).all(...params);
export const one = (sql, params = []) => db.prepare(sql).get(...params);
export function dateAdd(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function seed() {
  if (one("SELECT id FROM seed_info")) return;
  let state = 20261109;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const integer = (a, b) => a + Math.floor(random() * (b - a + 1));
  const pick = (a) => a[integer(0, a.length - 1)];
  const end =
    process.env.DW_SEED_END ||
    new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const start = dateAdd(end, -209);
  const stamp = new Date().toISOString();
  const insert = (table, columns) =>
    db.prepare(
      `INSERT INTO ${table} (${columns}) VALUES (${columns
        .split(",")
        .map(() => "?")
        .join(",")})`,
    );
  db.exec("BEGIN IMMEDIATE");
  try {
    // Recheck after acquiring the write lock so concurrent startup cannot duplicate seed data.
    if (one("SELECT id FROM seed_info")) {
      db.exec("COMMIT");
      return;
    }
    const store = insert("stores", "id,name");
    ["더현대 서울", "압구정본점", "판교점"].forEach((name, i) =>
      store.run(i + 1, name),
    );
    const product = insert("products", "id,name,category,price");
    const categories = ["패션", "식품", "리빙", "뷰티"];
    const prices = [69000, 18000, 85000, 42000];
    const products = [];
    for (let i = 1; i <= 48; i++) {
      const c = (i - 1) % 4;
      const p = { id: i, price: prices[c] * integer(1, 4) };
      products.push(p);
      product.run(
        i,
        `${categories[c]} 샘플 상품 ${String(i).padStart(2, "0")}`,
        categories[c],
        p.price,
      );
    }
    const customer = insert(
      "customers",
      "id,name,grade,joined_at,home_store_id",
    );
    const customers = [];
    for (let i = 1; i <= 3600; i++) {
      const n = random();
      const c = {
        id: i,
        date: dateAdd(start, i <= 180 ? 0 : integer(0, 206)),
        store: integer(1, 3),
        grade: n < 0.54 ? "일반" : n < 0.8 ? "실버" : n < 0.94 ? "골드" : "VIP",
      };
      customers.push(c);
      customer.run(
        i,
        `샘플고객 ${String(i).padStart(4, "0")}`,
        c.grade,
        c.date,
        c.store,
      );
    }
    const campaign = insert("campaigns", "id,name,channel,start_date,end_date");
    const campaignDefs = [
      ["재방문 쇼핑 쿠폰", "모바일 앱", -150, 0],
      ["신규 고객 웰컴", "모바일 앱", -209, 30],
      ["앱 푸시 재구매", "모바일 앱", -100, 14],
      ["VIP 프라이빗 초대", "오프라인", -65, -10],
      ["주말 쇼핑 리워드", "오프라인", -90, 7],
      ["시즌 감사 페스티벌", "오프라인", -209, -100],
    ];
    const target = insert(
      "campaign_targets",
      "id,campaign_id,customer_id,store_id,channel,targeted_at",
    );
    const customerTargets = new Map();
    const defs = [];
    let targetId = 0;
    campaignDefs.forEach(([name, channel, a, b], idx) => {
      const c = {
        id: idx + 1,
        name,
        channel,
        start: dateAdd(end, a),
        end: dateAdd(end, b),
      };
      defs.push(c);
      campaign.run(c.id, c.name, c.channel, c.start, c.end);
      for (const u of customers) {
        if (
          random() > 0.48 ||
          u.date > c.end ||
          (c.id === 4 && u.grade !== "VIP")
        )
          continue;
        const lower = u.date > c.start ? u.date : c.start;
        const upper = c.end > end ? end : c.end;
        if (lower > upper) continue;
        const span = Math.floor(
          (Date.parse(upper) - Date.parse(lower)) / 86400000,
        );
        const date = dateAdd(lower, integer(0, span));
        const t = {
          id: ++targetId,
          campaign: c.id,
          date,
          end: c.end,
          channel,
          store: u.store,
        };
        target.run(t.id, c.id, u.id, u.store, channel, date);
        customerTargets.set(u.id, [...(customerTargets.get(u.id) || []), t]);
      }
    });
    const order = insert(
      "orders",
      "id,customer_id,store_id,channel,ordered_at,status,campaign_target_id",
    );
    const item = insert(
      "order_items",
      "id,order_id,product_id,quantity,unit_price",
    );
    const payment = insert("payments", "id,order_id,amount,method,paid_at");
    const session = insert(
      "app_sessions",
      "id,customer_id,store_id,session_date,duration_seconds,viewed_product,added_cart,order_id",
    );
    let orderId = 0,
      itemId = 0,
      sessionId = 0;
    for (let d = 0; d < 210; d++) {
      const date = dateAdd(start, d);
      const eligible = customers.filter((c) => c.date <= date);
      const count =
        integer(110, 180) +
        Math.floor(d * 0.35) +
        (new Date(date).getUTCDay() % 6 === 0 ? 45 : 0);
      for (let k = 0; k < count; k++) {
        const u = pick(eligible),
          channel = random() < 0.58 ? "모바일 앱" : "오프라인",
          store = random() < 0.8 ? u.store : integer(1, 3);
        const candidates = (customerTargets.get(u.id) || []).filter(
          (t) =>
            t.channel === channel &&
            t.store === store &&
            t.date <= date &&
            t.end >= date,
        );
        const t = candidates.length && random() < 0.6 ? pick(candidates) : null;
        const status = random() < 0.035 ? "cancelled" : "completed";
        order.run(
          ++orderId,
          u.id,
          store,
          channel,
          date,
          status,
          t ? t.id : null,
        );
        let amount = 0;
        for (let j = 0, n = integer(1, 3); j < n; j++) {
          const p = pick(products),
            qty = integer(1, 2);
          item.run(++itemId, orderId, p.id, qty, p.price);
          amount += qty * p.price;
        }
        if (status === "completed") {
          payment.run(
            orderId,
            orderId,
            amount,
            pick(["신용카드", "현대백화점 상품권", "간편결제"]),
            date,
          );
          if (channel === "모바일 앱")
            session.run(
              ++sessionId,
              u.id,
              store,
              date,
              integer(80, 840),
              1,
              1,
              orderId,
            );
        }
      }
      for (let j = 0, n = integer(160, 300); j < n; j++) {
        const u = pick(eligible),
          view = random() < 0.78 ? 1 : 0,
          cart = view && random() < 0.35 ? 1 : 0;
        session.run(
          ++sessionId,
          u.id,
          u.store,
          date,
          integer(10, 720),
          view,
          cart,
          null,
        );
      }
    }
    const spend = insert(
      "campaign_spend",
      "campaign_id,store_id,channel,date,planned,spent",
    );
    const budget = insert(
      "budget_daily",
      "date,store_id,channel,department,planned,spent,sales_target",
    );
    for (let d = 0; d < 210; d++) {
      const date = dateAdd(start, d);
      for (let s = 1; s <= 3; s++) {
        for (const channel of ["모바일 앱", "오프라인"]) {
          let cp = 0,
            cs = 0;
          for (const c of defs.filter(
            (c) => c.start <= date && c.end >= date && c.channel === channel,
          )) {
            const p = integer(60000, 140000),
              v = Math.round(p * (0.5 + random() * 0.55));
            spend.run(c.id, s, channel, date, p, v);
            cp += p;
            cs += v;
          }
          budget.run(
            date,
            s,
            channel,
            "CRM 캠페인",
            cp,
            cs,
            integer(1500000, 2500000),
          );
          for (const department of ["디지털 마케팅", "점포 프로모션"]) {
            const p = integer(140000, 260000);
            budget.run(
              date,
              s,
              channel,
              department,
              p,
              Math.round(p * (0.45 + random() * 0.5)),
              integer(5000000, 8500000),
            );
          }
        }
      }
    }
    insert("settings", "key,value").run("workspaceName", "현대백화점 DW");
    insert("settings", "key,value").run("alertsEnabled", "true");
    insert("seed_info", "id,version,start_date,end_date,created_at").run(
      1,
      1,
      start,
      end,
      stamp,
    );
    const pipeline = insert(
      "pipeline_runs",
      "id,name,status,finished_at,processed_rows",
    );
    pipeline.run(1, "고객·상품 기준정보 생성", "success", stamp, 3648);
    pipeline.run(2, "주문·결제 샘플 적재", "success", stamp, orderId);
    pipeline.run(3, "앱 세션 적재", "success", stamp, sessionId);
    pipeline.run(
      4,
      "캠페인·예산 적재",
      "success",
      stamp,
      one("SELECT COUNT(*) n FROM budget_daily").n + targetId,
    );
    const metadata = [
      ["stores", "SOURCE", "공통", "점포 기준정보", "영업관리팀"],
      ["products", "SOURCE", "매출", "상품·상품군·가격", "상품기획팀"],
      ["customers", "SOURCE", "고객", "가상 고객과 회원 등급", "CRM팀"],
      ["orders", "SOURCE", "매출", "주문 원장 (취소 포함)", "커머스플랫폼팀"],
      [
        "order_items",
        "SOURCE",
        "매출",
        "주문별 상품·수량·단가",
        "커머스플랫폼팀",
      ],
      ["payments", "SOURCE", "매출", "완료 주문의 결제 금액", "커머스플랫폼팀"],
      ["campaigns", "SOURCE", "캠페인", "캠페인 일정과 채널", "마케팅팀"],
      ["campaign_targets", "SOURCE", "캠페인", "캠페인별 대상 고객", "CRM팀"],
      [
        "campaign_spend",
        "SOURCE",
        "예산",
        "캠페인별 일 예산·실집행",
        "마케팅팀",
      ],
      [
        "app_sessions",
        "SOURCE",
        "앱",
        "앱 방문·조회·장바구니·구매 세션",
        "디지털서비스팀",
      ],
      [
        "budget_daily",
        "SOURCE",
        "예산",
        "일·점포·채널·부문별 예산과 목표",
        "재무팀",
      ],
      [
        "dw_fact_orders",
        "WAREHOUSE",
        "매출",
        "완료 주문과 결제의 조인 뷰",
        "Data Platform",
      ],
      [
        "mart_sales_daily",
        "DATA MART",
        "매출",
        "일·점포·채널별 매출 집계 뷰",
        "데이터분석팀",
      ],
      [
        "mart_customer_ltv",
        "DATA MART",
        "고객",
        "전체 이력의 고객 구매·생애가치 뷰",
        "CRM팀",
      ],
      [
        "report_sales",
        "CONSUMPTION",
        "매출",
        "매출 집계와 점포명 조회 뷰",
        "데이터분석팀",
      ],
      [
        "report_customers",
        "CONSUMPTION",
        "고객",
        "고객 생애가치 조회 뷰",
        "CRM팀",
      ],
    ];
    const meta = insert(
      "asset_metadata",
      "id,name,type,domain,description,owner",
    );
    for (const [id, type, domain, description, owner] of metadata)
      meta.run(id, id, type, domain, description, owner);
    // Edges describe SQL view dependencies, not external products that are not connected.
    const edge = insert("asset_edges", "source,target");
    for (const [a, b] of [
      ["orders", "dw_fact_orders"],
      ["payments", "dw_fact_orders"],
      ["dw_fact_orders", "mart_sales_daily"],
      ["dw_fact_orders", "mart_customer_ltv"],
      ["customers", "mart_customer_ltv"],
      ["mart_sales_daily", "report_sales"],
      ["stores", "report_sales"],
      ["mart_customer_ltv", "report_customers"],
    ])
      edge.run(a, b);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
seed();
