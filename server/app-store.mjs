import { randomUUID } from "node:crypto";
import { all, one, transaction, db, fixtureMode } from "./db.mjs";
import { validateSpec, validateStore, bad } from "./app-plans.mjs";
const ddl = [
  `CREATE TABLE IF NOT EXISTS analysis_apps (id VARCHAR(36) PRIMARY KEY, title VARCHAR(60) NOT NULL, spec TEXT NOT NULL, version INTEGER NOT NULL, created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS analysis_app_versions (id VARCHAR(36) PRIMARY KEY, app_id VARCHAR(36) NOT NULL, version INTEGER NOT NULL, spec TEXT NOT NULL, prompt TEXT NOT NULL, created_at VARCHAR(32) NOT NULL, UNIQUE(app_id,version), FOREIGN KEY(app_id) REFERENCES analysis_apps(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS metric_agents (id VARCHAR(36) PRIMARY KEY, app_id VARCHAR(36) NOT NULL, name VARCHAR(80) NOT NULL, config TEXT NOT NULL, enabled INTEGER NOT NULL, next_run VARCHAR(32) NOT NULL, created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL, FOREIGN KEY(app_id) REFERENCES analysis_apps(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS metric_agent_runs (id VARCHAR(36) PRIMARY KEY, agent_id VARCHAR(36) NOT NULL, slot VARCHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL, status VARCHAR(20) NOT NULL, report TEXT NOT NULL, created_at VARCHAR(32) NOT NULL, finished_at VARCHAR(32), UNIQUE(agent_id,slot), FOREIGN KEY(agent_id) REFERENCES metric_agents(id) ON DELETE CASCADE)`,
];
export async function initializeApps() {
  for (const sql of ddl) {
    if (fixtureMode) db.exec(sql);
    else await db.query(sql + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  }
}
export const stamp = () => new Date().toISOString();
export const decodeApp = (r) => (r ? { ...r, spec: JSON.parse(r.spec) } : null);
export async function getApp(id) {
  const r = decodeApp(
    await one("SELECT * FROM analysis_apps WHERE id=?", [id]),
  );
  if (!r) bad("분석 앱을 찾을 수 없습니다.", 404);
  return r;
}
export async function listApps() {
  return (
    await all("SELECT * FROM analysis_apps ORDER BY updated_at DESC")
  ).map(decodeApp);
}
export async function saveApp(input, id) {
  const spec = await validateStore(validateSpec(input?.spec)),
    now = stamp();
  const prompt =
    typeof input.prompt === "string"
      ? input.prompt.slice(0, 1000)
      : "직접 구성";
  if (id) {
    const old = await getApp(id);
    const { validateAgent } = await import("./metric-agents.mjs");
    for (const agent of await all(
      "SELECT config FROM metric_agents WHERE app_id=?",
      [id],
    )) {
      try {
        validateAgent(JSON.parse(agent.config), spec);
      } catch {
        bad(
          "연결된 감시에서 사용하는 지표나 분석 축입니다. 감시를 먼저 수정하거나 삭제하세요.",
          409,
        );
      }
    }
    if (input.version !== old.version)
      bad("다른 변경이 저장되었습니다. 앱을 다시 열어주세요.", 409);
    try {
      await transaction(async (tx) => {
        const result = await tx.run(
          "UPDATE analysis_apps SET title=?,spec=?,version=?,updated_at=? WHERE id=? AND version=?",
          [
            spec.title,
            JSON.stringify(spec),
            old.version + 1,
            now,
            id,
            old.version,
          ],
        );
        const n = fixtureMode ? result.changes : result[0].affectedRows;
        if (!n) bad("다른 변경이 저장되었습니다. 앱을 다시 열어주세요.", 409);
        await tx.run(
          "INSERT INTO analysis_app_versions (id,app_id,version,spec,prompt,created_at) VALUES (?,?,?,?,?,?)",
          [
            randomUUID(),
            id,
            old.version + 1,
            JSON.stringify(spec),
            prompt,
            now,
          ],
        );
      });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        bad("저장 충돌이 발생했습니다. 다시 열어주세요.", 409);
      throw e;
    }
    return getApp(id);
  }
  id = randomUUID();
  await transaction(async (tx) => {
    await tx.run(
      "INSERT INTO analysis_apps (id,title,spec,version,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      [id, spec.title, JSON.stringify(spec), 1, now, now],
    );
    await tx.run(
      "INSERT INTO analysis_app_versions (id,app_id,version,spec,prompt,created_at) VALUES (?,?,?,?,?,?)",
      [randomUUID(), id, 1, JSON.stringify(spec), prompt, now],
    );
  });
  return getApp(id);
}
export async function appVersions(id) {
  await getApp(id);
  return (
    await all(
      "SELECT * FROM analysis_app_versions WHERE app_id=? ORDER BY version DESC",
      [id],
    )
  ).map((r) => ({ ...r, spec: JSON.parse(r.spec) }));
}
export async function deleteApp(id) {
  await getApp(id);
  if (
    await one(
      "SELECT r.id FROM metric_agent_runs r JOIN metric_agents a ON a.id=r.agent_id WHERE a.app_id=? AND r.status='running'",
      [id],
    )
  )
    bad("감시 실행이 끝난 뒤 삭제하세요.", 409);
  await transaction((tx) =>
    tx.run("DELETE FROM analysis_apps WHERE id=?", [id]),
  );
}
