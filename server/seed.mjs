import { db, dbPath, one } from "./db.mjs";
console.log("DB 준비 완료:", dbPath);
console.log(one("SELECT * FROM seed_info"));
console.log("주문:", one("SELECT COUNT(*) count FROM orders").count, "건");
db.close();
