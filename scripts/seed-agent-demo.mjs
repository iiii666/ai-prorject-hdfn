import { initialize,close } from "../server/db.mjs";
import { initializeApps } from "../server/app-store.mjs";
import { seedDemoHistory } from "../server/agent-history.mjs";
try {await initialize();await initializeApps();console.log(await seedDemoHistory());} finally {await close();}
