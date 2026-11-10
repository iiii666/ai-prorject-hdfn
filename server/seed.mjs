import { initialize, one, close, databaseEngine } from "./db.mjs";
try {
  await initialize();
  console.log(databaseEngine, "DB 준비 완료");
  console.log(await one("SELECT * FROM seed_info"));
  console.log(
    "주문:",
    (await one("SELECT COUNT(*) count FROM orders")).count,
    "건",
  );
} finally {
  await close();
}
