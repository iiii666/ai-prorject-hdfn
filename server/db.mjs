import "./config.mjs";
import pg from "pg";
import { readFileSync } from "node:fs";
export const fixtureMode =
  process.env.DW_TEST_SQLITE === "1" && process.env.DW_DB_PATH === ":memory:";
export const databaseEngine = fixtureMode
  ? "SQLite test fixture"
  : "PostgreSQL";
export function dateAdd(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
// PostgreSQL returns BIGINT/NUMERIC (COUNT, SUM, AVG) as strings by default.
// The API contract uses JS numbers, and dates are kept as plain text.
pg.types.setTypeParser(20, Number); // int8
pg.types.setTypeParser(1700, Number); // numeric
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);
// Connection settings: DATABASE_URL (Supabase) or the individual DB_* variables.
// The URL is parsed here instead of passed through to pg, because pg lets URL
// query parameters such as sslmode override the explicit ssl option.
function connectionConfig() {
  const e = process.env;
  let c;
  if (e.DATABASE_URL) {
    const u = new URL(e.DATABASE_URL);
    c = {
      host: u.hostname,
      port: Number(u.port || 5432),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.slice(1)) || "postgres",
    };
  } else {
    c = {
      host: e.DB_HOST || "127.0.0.1",
      port: Number(e.DB_PORT || 5432),
      user: e.DB_USER || "postgres",
      password: e.DB_PASSWORD,
      database: e.DB_DATABASE || "postgres",
    };
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(c.host);
  const mode = (e.DB_SSL || (local ? "false" : "require")).toLowerCase();
  // DB_SSL_CA verifies the server certificate. DB_SSL=require encrypts the
  // connection but does not verify the certificate chain.
  if (e.DB_SSL_CA)
    c.ssl = { ca: readFileSync(e.DB_SSL_CA, "utf8"), rejectUnauthorized: true };
  else if (mode !== "false" && mode !== "disable")
    c.ssl = { rejectUnauthorized: false };
  return c;
}
const config = fixtureMode ? null : connectionConfig();
export const dbPath = fixtureMode
  ? ":memory:"
  : `${config.host}:${config.port}/${config.database}`;
// SQL shared with the SQLite fixture uses "?" placeholders, camelCase aliases and
// MySQL-style case-insensitive LIKE. Convert them outside of string literals.
function normalize(sql) {
  let out = "",
    n = 0;
  for (const part of sql.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|[^'"]+|['"]/g) ||
    []) {
    if (part[0] === "'" || part[0] === '"') out += part;
    else
      out += part
        .replace(/\?/g, () => "$" + ++n)
        .replace(/\bLIKE\b/g, "ILIKE")
        // PostgreSQL folds unquoted identifiers to lower case; keep aliases such as activeCustomers.
        .replace(/\b[a-z][a-z0-9_]*[A-Z][A-Za-z0-9_]*\b/g, '"$&"');
  }
  return out;
}
let backend;
if (fixtureMode) {
  backend = (await import("./fixtures/db.mjs")).db;
} else {
  backend = new pg.Pool({
    ...config,
    max: 6,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    application_name: "hyundai-dw",
  });
  // An idle client dropped by the server or a pooler must not crash the process.
  backend.on("error", (e) => console.error("DB 유휴 연결 오류:", e.code || e.message));
}
export const db = backend;
export const all = async (sql, params = []) =>
  fixtureMode
    ? db.prepare(sql).all(...params)
    : (await db.query(normalize(sql), params)).rows;
export const one = async (sql, params = []) => (await all(sql, params))[0];
// Runs fn on one connection inside BEGIN/COMMIT. Serializes concurrent callers
// (several PCs sharing one database) on an advisory lock when `lock` is given.
async function withClient(fn, lock) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    if (lock)
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lock]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export async function transaction(fn) {
  if (fixtureMode) {
    db.exec("BEGIN");
    try {
      const out = await fn({
        run: async (sql, args) => db.prepare(sql).run(...args),
        one: async (sql, args = []) => db.prepare(sql).get(...args),
      });
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return withClient((c) =>
    fn({
      // Keeps the [{ affectedRows }] shape the callers already read.
      run: async (sql, args = []) => [
        { affectedRows: (await c.query(normalize(sql), args)).rowCount },
      ],
      one: async (sql, args = []) =>
        (await c.query(normalize(sql), args)).rows[0],
    }),
  );
}
export async function close() {
  if (fixtureMode) db.close();
  else await db.end();
}
export async function seed() {
  if (fixtureMode) return (await import("./fixtures/db.mjs")).seed();
  return initialize();
}
export async function tableNames() {
  return fixtureMode
    ? all("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
    : all(
        "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m')",
      );
}
export async function columns(name) {
  return fixtureMode
    ? all("SELECT name,type,pk FROM pragma_table_info(?)", [name])
    : await all(
        "SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,CASE WHEN EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)) THEN 1 ELSE 0 END AS pk FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=? AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
        [name],
      );
}
export async function countRows(name) {
  if (!/^[a-z_]+$/.test(name)) throw Error("Invalid table identifier");
  return one(`SELECT COUNT(*) count FROM "${name}"`);
}
// Applies CREATE statements on an open transaction. Supabase exposes the public
// schema through its REST API, so every table gets row level security with no
// policies (the direct database connection of this server is unaffected as the
// table owner) and every view runs with the privileges of the caller.
async function applyDdl(c, statements) {
  const tables = [],
    views = [];
  for (const stmt of statements) {
    await c.query(stmt);
    const t = /^CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(stmt),
      v = /^CREATE OR REPLACE VIEW\s+(\w+)/i.exec(stmt);
    if (t) tables.push(t[1]);
    if (v) views.push(v[1]);
  }
  for (const t of tables)
    await c.query(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
  for (const v of views)
    await c.query(`ALTER VIEW "${v}" SET (security_invoker = true)`);
}
export async function ddl(statements) {
  if (fixtureMode) return;
  await withClient((c) => applyDdl(c, statements), "hyundai-dw:ddl");
}
let initialization;
export function initialize() {
  if (fixtureMode) return Promise.resolve();
  if (!initialization) initialization = initializePostgres();
  return initialization;
}
async function initializePostgres() {
  console.log("[DB] Supabase 연결 및 초기화를 시작합니다. 첫 실행은 샘플 적재로 시간이 걸릴 수 있습니다.");
  // One transaction under an advisory lock: PCs starting at the same time wait
  // for each other, and a failed load leaves no half-seeded database behind.
  await withClient(async (c) => {
    console.log("[DB] 연결 완료. 테이블을 준비합니다.");
    const schema = readFileSync(
      new URL("./schema.sql", import.meta.url),
      "utf8",
    );
    await applyDdl(
      c,
      schema
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const { rows: [existing] } = await c.query(
      "SELECT COUNT(*) AS count FROM seed_info",
    );
    if (existing.count) {
      console.log("[DB] 기존 데이터를 사용합니다.");
      return;
    }
    // Refuse to mix an incomplete or manually populated database with generated fixtures.
    const { rows: [occupied] } = await c.query(
      "SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM customers)+(SELECT COUNT(*) FROM settings) AS count",
    );
    if (occupied.count)
      throw Error(
        "기존 데이터가 있는 DB에는 자동 샘플을 혼합하지 않습니다. 별도 빈 DB를 선택하세요.",
      );
    const { createSource } = await import("./fixtures/source.mjs");
    console.log("[DB] 초기 샘플 데이터를 생성합니다.");
    const source = await createSource();
    const tables = [
      "stores",
      "products",
      "customers",
      "campaigns",
      "campaign_targets",
      "orders",
      "order_items",
      "payments",
      "app_sessions",
      "campaign_spend",
      "budget_daily",
      "settings",
      "seed_info",
      "pipeline_runs",
      "asset_metadata",
      "asset_edges",
    ];
    try {
      for (const name of tables) {
        const rows = source.prepare(`SELECT * FROM ${name}`).all();
        if (!rows.length) continue;
        console.log(`[DB] ${name}: ${rows.length.toLocaleString()}행 적재 시작`);
        const keys = Object.keys(rows[0]);
        // Reduce remote round trips while staying below PostgreSQL's parameter limit.
        const batchSize = Math.min(5000, Math.floor(60000 / keys.length));
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const marks = batch
            .map(
              (_, r) =>
                "(" +
                keys.map((_, k) => "$" + (r * keys.length + k + 1)).join(",") +
                ")",
            )
            .join(",");
          await c.query(
            `INSERT INTO "${name}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES ${marks}`,
            batch.flatMap((row) => keys.map((k) => row[k])),
          );
          if ((i + batch.length) % 10000 === 0 || i + batch.length >= rows.length)
            console.log(`[DB] ${name}: ${(i + batch.length).toLocaleString()}/${rows.length.toLocaleString()}행`);
        }
      }
    } finally {
      source.close();
    }
  }, "hyundai-dw:initialize");
  console.log("[DB] 데이터 준비 완료.");
}
