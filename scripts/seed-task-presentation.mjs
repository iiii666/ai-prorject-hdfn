import { initialize, close } from "../server/db.mjs";
import { initializeApps } from "../server/app-store.mjs";
import { initializeInvestigations } from "../server/investigation-store.mjs";
import { seedPresentationTask } from "../server/presentation-scenario.mjs";
const agentId = process.argv[2];
if (!agentId) throw Error("시연을 준비할 업무 ID를 인자로 지정하세요.");
try {
  await initialize(); await initializeApps(); await initializeInvestigations();
  console.log(JSON.stringify(await seedPresentationTask(agentId), null, 2));
} finally { await close(); }
