import { bad } from "./app-plans.mjs";
import { toolCatalog } from "./investigation-tools.mjs";
import {
  listInvestigations,
  getInvestigation,
  createInvestigation,
} from "./investigation-store.mjs";
import {
  sendInvestigationMessage,
  investigationStep,
  pauseInvestigation,
} from "./investigation-agent.mjs";
import { approveInvestigation } from "./investigation-export.mjs";
export async function investigationApi(path, method, body) {
  if (path === "/api/investigations/meta" && method === "GET")
    return {
      configured: !!process.env.OPENAI_API_KEY,
      catalog: await toolCatalog(),
      maxQueries: 6,
      maxRounds: 20,
    };
  if (path === "/api/investigations") {
    if (method === "GET") return listInvestigations();
    if (method === "POST") return createInvestigation(await body());
  }
  const match = path.match(
    /^\/api\/investigations\/([a-f0-9-]{36})(?:\/(messages|step|pause|approve))?$/,
  );
  if (match) {
    const [, id, action] = match;
    if (!action && method === "GET") return getInvestigation(id);
    if (method === "POST") {
      const data = await body();
      if (!data || typeof data !== "object" || Array.isArray(data))
        bad("조사 요청 내용을 확인하세요.");
      if (action === "messages") return sendInvestigationMessage(id, data);
      if (action === "step") return investigationStep(id, data);
      if (action === "pause") return pauseInvestigation(id, data);
      if (action === "approve") return approveInvestigation(id, data);
    }
  }
  bad("조사 에이전트 API 경로 또는 메서드를 확인하세요.", 404);
}
