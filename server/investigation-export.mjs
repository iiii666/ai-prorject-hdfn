import { randomUUID } from "node:crypto";
import { transaction, fixtureMode } from "./db.mjs";
import { bad, validateSpec, validateStore } from "./app-plans.mjs";
import { getInvestigation, checkVersion } from "./investigation-store.mjs";
import { validateAgent, nextRun } from "./metric-agents.mjs";
export async function approveInvestigation(id, input) {
  const session = await getInvestigation(id),
    round = session.state.rounds.at(-1),
    proposal = round.proposal;
  if (!proposal || proposal.id !== input.proposalId)
    bad("현재 조사 결과의 저장 초안을 확인하세요.", 409);
  if (proposal.saved) return session;
  checkVersion(session, input.version);
  const spec = await validateStore(
    validateSpec({ ...proposal.spec, title: input.title }),
  );
  const config = validateAgent(
    { ...proposal.config, investigationMode: session.state.mode,
      objective: session.state.rounds[0].prompt,
      ...input.config, name: spec.title + " 정기 점검" },
    spec,
  );
  if (typeof input.enabled !== "boolean") bad("감시 활성화 여부를 확인하세요.");
  const appId = randomUUID(),
    agentId = randomUUID(),
    now = new Date().toISOString();
  await transaction(async (tx) => {
    const row = await tx.one(
      "SELECT * FROM investigation_sessions WHERE id=?" +
        (fixtureMode ? "" : " FOR UPDATE"),
      [id],
    );
    if (row.version !== input.version)
      bad("조사 상태가 바뀌었습니다. 최신 대화를 확인하세요.", 409);
    proposal.status = "saved";
    proposal.spec = spec;
    proposal.config = config;
    proposal.enabled = input.enabled;
    proposal.saved = { appId, agentId, at: now };
    await tx.run(
      "INSERT INTO analysis_apps (id,title,spec,version,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      [appId, spec.title, JSON.stringify(spec), 1, now, now],
    );
    await tx.run(
      "INSERT INTO analysis_app_versions (id,app_id,version,spec,prompt,created_at) VALUES (?,?,?,?,?,?)",
      [randomUUID(), appId, 1, JSON.stringify(spec), round.prompt, now],
    );
    await tx.run(
      "INSERT INTO metric_agents (id,app_id,name,config,enabled,next_run,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        agentId,
        appId,
        config.name,
        JSON.stringify(config),
        Number(input.enabled),
        nextRun(config),
        now,
        now,
      ],
    );
    await tx.run(
      "UPDATE investigation_sessions SET state=?,version=version+1,updated_at=? WHERE id=?",
      [JSON.stringify(session.state), now, id],
    );
  });
  return getInvestigation(id);
}
