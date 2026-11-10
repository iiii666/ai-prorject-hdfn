import "./config.mjs";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
export const fixtureMode =
  process.env.DW_TEST_SQLITE === "1" && process.env.DW_DB_PATH === ":memory:";
export const databaseEngine = fixtureMode ? "SQLite test fixture" : "MySQL";
export const dbPath = fixtureMode
  ? ":memory:"
  : `${process.env.DB_HOST || "127.0.0.1"}:${process.env.DB_PORT || 3306}/${process.env.DB_DATABASE || "hyundai_dw"}`;
export function dateAdd(date, days) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
// Text dates retain the existing API contract. DECIMAL aggregate values are JS numbers.
const normalize = (sql) =>
  sql
    .replace(/\bAS INTEGER\b/gi, "AS SIGNED")
    .replace(/\bAS TEXT\b/gi, "AS CHAR")
    .replace(/\bkey\b/g, "`key`");
let backend;
if (fixtureMode) {
  backend = (await import("./fixtures/db.mjs")).db;
} else
  backend = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "dw_app",
    password: process.env.DB_PASSWORD || "dw_local_password",
    database: process.env.DB_DATABASE || "hyundai_dw",
    connectionLimit: 6,
    decimalNumbers: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: "utf8mb4",
    connectTimeout: 10000,
  });
export const db = backend;
export const all = async (sql, params = []) =>
  fixtureMode
    ? db.prepare(sql).all(...params)
    : (await db.query(normalize(sql), params))[0];
export const one = async (sql, params = []) => (await all(sql, params))[0];
export async function transaction(fn) {
  if (fixtureMode) {
    db.exec("BEGIN");
    try {
      const out = await fn({
        run: async (sql, args) => db.prepare(sql).run(...args),
      });
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn({
      run: (sql, args = []) => c.query(normalize(sql), args),
    });
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
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
        "SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()",
      );
}
export async function columns(name) {
  return fixtureMode
    ? all("SELECT name,type,pk FROM pragma_table_info(?)", [name])
    : await all(
        "SELECT COLUMN_NAME name,COLUMN_TYPE type,CASE WHEN COLUMN_KEY='PRI' THEN 1 ELSE 0 END pk FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
        [name],
      );
}
export async function countRows(name) {
  if (!/^[a-z_]+$/.test(name)) throw Error("Invalid table identifier");
  return fixtureMode
    ? one(`SELECT COUNT(*) count FROM "${name}"`)
    : one("SELECT COUNT(*) count FROM `" + name + "`");
}
let initialization;
export function initialize() {
  if (fixtureMode) return Promise.resolve();
  if (!initialization) initialization = initializeMySQL();
  return initialization;
}
async function initializeMySQL() {
  const connection = await db.getConnection();
  let locked = false;
  try {
    const [[lock]] = await connection.query(
      "SELECT GET_LOCK(CONCAT(DATABASE(),':initialize'),120) acquired",
    );
    if (lock.acquired !== 1) throw Error("DB initialization lock unavailable");
    locked = true;
    const schema = readFileSync(
      new URL("./schema.sql", import.meta.url),
      "utf8",
    );
    for (const stmt of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(stmt);
    const [[existing]] = await connection.query(
      "SELECT COUNT(*) count FROM seed_info",
    );
    if (existing.count) return;
    // Refuse to mix an incomplete or manually populated database with generated fixtures.
    const [[occupied]] = await connection.query(
      "SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM customers)+(SELECT COUNT(*) FROM settings) count",
    );
    if (occupied.count)
      throw Error(
        "기존 데이터가 있는 DB에는 자동 샘플을 혼합하지 않습니다. 별도 빈 DB를 선택하세요.",
      );
    const { createSource } = await import("./fixtures/source.mjs");
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
    await connection.beginTransaction();
    try {
      for (const name of tables) {
        const rows = source.prepare(`SELECT * FROM ${name}`).all();
        if (!rows.length) continue;
        const keys = Object.keys(rows[0]);
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows
            .slice(i, i + 500)
            .map((row) => keys.map((k) => row[k]));
          await connection.query(
            "INSERT INTO `" +
              name +
              "` (" +
              keys.map((k) => "`" + k + "`").join(",") +
              ") VALUES ?",
            [batch],
          );
        }
      }
      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      source.close();
    }
  } finally {
    if (locked)
      await connection.query(
        "SELECT RELEASE_LOCK(CONCAT(DATABASE(),':initialize'))",
      );
    connection.release();
  }
}
