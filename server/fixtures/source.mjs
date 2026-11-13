// Sample generation/import is separate from the live PostgreSQL data access layer.
export async function createSource() {
  if (process.env.DB_IMPORT_SQLITE) {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(process.env.DB_IMPORT_SQLITE, { readOnly: true });
  }
  const { db } = await import("./db.mjs");
  const { extendHistory } = await import("../history.mjs");
  const { extendOperationalHistory } =
    await import("../operational-history.mjs");
  extendHistory(db);
  extendOperationalHistory(db);
  return db;
}
