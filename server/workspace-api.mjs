import { historyList, historyDetail, seedDemoHistory } from "./agent-history.mjs";
import { planApp, planAgent, bad, METRICS, DIMENSIONS } from "./app-plans.mjs";
import { appData } from "./app-data.mjs";
import { all } from "./db.mjs";
import {
  listApps,
  getApp,
  saveApp,
  appVersions,
  deleteApp,
} from "./app-store.mjs";
import {
  listAgents,
  saveAgent,
  getAgent,
  deleteAgent,
  agentRuns,
  runAgent,
} from "./metric-agents.mjs";
export async function workspaceApi(path, method, readBody, params) {
  if (path === "/api/my-apps/meta" && method === "GET")
    return {
      metrics: METRICS,
      dimensions: DIMENSIONS,
      aiConfigured: !!process.env.OPENAI_API_KEY,
    };
  if (path === "/api/my-apps/plan" && method === "POST")
    return planApp(await readBody());
  if (path === "/api/my-apps/preview" && method === "POST")
    return appData((await readBody()).spec);
  if (path === "/api/my-apps") {
    if (method === "GET") return listApps();
    if (method === "POST") return saveApp(await readBody());
  }
  const match = path.match(
    /^\/api\/my-apps\/([a-f0-9-]{36})(?:\/(data|versions))?$/,
  );
  if (match) {
    const [, id, action] = match;
    if (method === "GET")
      return action === "data"
        ? await (async () => {
            const app = await getApp(id);
            const scenario = (await all("SELECT config FROM metric_agents WHERE app_id=?", [id]))
              .map((a) => JSON.parse(a.config).demoScenario).find(Boolean);
            if (!scenario) return appData(app.spec);
            const { scenarioData } = await import("./presentation-scenario.mjs");
            return scenarioData(app.spec, { ...scenario, phase: 2 });
          })()
        : action === "versions"
          ? appVersions(id)
          : getApp(id);
    if (!action && method === "PUT") return saveApp(await readBody(), id);
    if (!action && method === "DELETE") {
      await deleteApp(id);
      return { deleted: true };
    }
  }
  if (path === "/api/metric-agents/history" && method === "GET") return historyList(params);
  if (path === "/api/metric-agents/demo" && method === "POST") return seedDemoHistory();
  const history=path.match(/^\/api\/metric-agents\/history\/([a-f0-9-]{36})$/);
  if(history && method === "GET")return historyDetail(history[1]);
  if (path === "/api/metric-agents/plan" && method === "POST") {
    const input = await readBody();
    const app = await getApp(input.appId);
    const out = await planAgent({ prompt: input.prompt, spec: app.spec });
    if (out?.supported !== true)
      bad(
        typeof out?.message === "string"
          ? out.message
          : "지원하지 않는 감시 요청입니다.",
      );
    const { validateAgent } = await import("./metric-agents.mjs");
    return {
      config: validateAgent(out.config, app.spec),
      message: String(out.message).slice(0, 1000),
    };
  }
  if (path === "/api/metric-agents") {
    if (method === "GET") return listAgents();
    if (method === "POST") return saveAgent(await readBody());
  }
  const agent = path.match(
    /^\/api\/metric-agents\/([a-f0-9-]{36})(?:\/(runs|test))?$/,
  );
  if (agent) {
    const [, id, action] = agent;
    if (method === "GET" && action === "runs") return agentRuns(id);
    if (method === "POST" && action === "test") return runAgent(id);
    if (!action && method === "GET") return getAgent(id);
    if (!action && method === "PUT") return saveAgent(await readBody(), id);
    if (!action && method === "DELETE") {
      await deleteAgent(id);
      return { deleted: true };
    }
  }
  bad("분석 앱 API 경로 또는 메서드를 확인하세요.", 404);
}
