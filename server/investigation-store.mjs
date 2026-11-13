import { randomUUID } from "node:crypto";
import { all, one, db, fixtureMode, transaction, ddl as createTables } from "./db.mjs";
import { bad } from "./app-plans.mjs";
import { defaultScope, validateScope } from "./investigation-tools.mjs";
export async function initializeInvestigations() {
  const sql =
    "CREATE TABLE IF NOT EXISTS investigation_sessions (id VARCHAR(36) PRIMARY KEY,title VARCHAR(60) NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,status VARCHAR(24) NOT NULL,created_at VARCHAR(32) NOT NULL,updated_at VARCHAR(32) NOT NULL)";
  if (fixtureMode) db.exec(sql);
  else await createTables([sql]);
}
export function promptText(value) {
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.length > 1000
  )
    bad("요청은 3~1,000자로 입력하세요.");
  if (
    /주민|전화번호|이메일|고객\s*명단|api.?key|password|system\s*prompt|ignore.*instructions|\b(select|drop|delete|insert|update|alter)\s/i.test(
      value,
    )
  )
    bad("개인정보·시스템 정보·SQL 실행 요청은 지원하지 않습니다.");
  return value.trim();
}
export function explicitChannel(prompt, scope, previous) {
  let lockedChannel = previous;
  if (/(모바일|앱).*(만|쪽)/.test(prompt)) lockedChannel = "모바일 앱";
  else if (/오프라인.*(만|쪽)/.test(prompt)) lockedChannel = "오프라인";
  else if (/전체\s*채널|모든\s*채널|채널\s*전체/.test(prompt)) {
    lockedChannel = undefined;
    scope.channel = "";
  }
  if (lockedChannel) scope.channel = lockedChannel;
  return lockedChannel;
}
const decode = (r) => ({ ...r, state: JSON.parse(r.state) });
export async function listInvestigations() {
  return all(
    "SELECT id,title,version,status,created_at,updated_at FROM investigation_sessions ORDER BY updated_at DESC LIMIT 50",
  );
}
export async function getInvestigation(id) {
  const r = await one("SELECT * FROM investigation_sessions WHERE id=?", [id]);
  if (!r) bad("조사 대화를 찾을 수 없습니다.", 404);
  return decode(r);
}
export async function createInvestigation(input, { task } = {}) {
  const prompt = promptText(input?.prompt);
  if (!["live", "demo"].includes(input.mode)) bad("조사 모드를 확인하세요.");
  if (input.mode === "live" && !process.env.OPENAI_API_KEY)
    bad(
      "실제 AI 조사에는 OpenAI API 키가 필요합니다. 샘플 시연 모드로 데이터 흐름을 확인할 수 있습니다.",
      503,
    );
  const scope = input.scope
      ? await validateScope(input.scope)
      : await defaultScope(),
    now = new Date().toISOString(),
    id = randomUUID();
  const lockedChannel = explicitChannel(
    prompt,
    scope,
    input.scope?.channel || undefined,
  );
  const state = {
    mode: input.mode,
    ...(task ? { task } : {}),
    messages: [{ id: randomUUID(), role: "user", text: prompt, at: now }],
    rounds: [
      {
        id: randomUUID(),
        prompt,
        scope,
        lockedChannel,
        status: "running",
        steps: [],
        decisions: 0,
      },
    ],
  };
  await transaction((tx) =>
    tx.run(
      "INSERT INTO investigation_sessions (id,title,state,version,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      [id, prompt.slice(0, 60), JSON.stringify(state), 1, "running", now, now],
    ),
  );
  return getInvestigation(id);
}
export async function persistInvestigation(session, expected) {
  const status = session.state.rounds.at(-1).status;
  const result = await transaction((tx) =>
    tx.run(
      "UPDATE investigation_sessions SET state=?,version=version+1,status=?,updated_at=? WHERE id=? AND version=?",
      [
        JSON.stringify(session.state),
        status,
        new Date().toISOString(),
        session.id,
        expected,
      ],
    ),
  );
  const n = fixtureMode ? result.changes : result[0].affectedRows;
  if (!n) bad("조사 상태가 바뀌었습니다. 최신 대화를 다시 조회합니다.", 409);
  return getInvestigation(session.id);
}
export function checkVersion(session, value) {
  if (!Number.isInteger(value) || session.version !== value)
    bad("조사 상태가 바뀌었습니다. 최신 대화를 다시 조회합니다.", 409);
}
