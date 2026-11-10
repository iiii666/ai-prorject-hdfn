import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (existsSync(new URL("../.env", import.meta.url)))
  loadEnvFile(new URL("../.env", import.meta.url));
import { customAnalysis, customStatus, AnalysisError } from "./custom.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { db, one } from "./db.mjs";
import {
  bootstrap,
  filters,
  analytics,
  catalog,
  settings,
  orderList,
} from "./analytics.mjs";
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const json = (res, data, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error("400:요청이 너무 큽니다.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("400:JSON 요청이 올바르지 않습니다.");
  }
}
export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    if (p === "/api/custom/status" && req.method === "GET")
      return json(res, customStatus());
    if (p === "/api/custom/analyze" && req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`)
        return json(
          res,
          { error: "같은 사이트에서만 분석을 요청할 수 있습니다." },
          403,
        );
      try {
        return json(res, await customAnalysis(await body(req)));
      } catch (e) {
        if (e instanceof AnalysisError)
          return json(res, { error: e.message }, e.status);
        throw e;
      }
    }
    if (p === "/api/health" && req.method === "GET")
      return json(res, {
        status: "ok",
        database: "SQLite",
        seed: one("SELECT * FROM seed_info"),
      });
    if (p === "/api/bootstrap" && req.method === "GET")
      return json(res, bootstrap());
    if (p === "/api/analytics" && req.method === "GET")
      return json(res, analytics(filters(url.searchParams)));
    if (p === "/api/catalog" && req.method === "GET")
      return json(res, catalog());
    if (p === "/api/orders" && req.method === "GET")
      return json(res, orderList(filters(url.searchParams), url.searchParams));
    if (p === "/api/settings" && req.method === "PATCH") {
      const data = await body(req);
      if (
        !data ||
        typeof data.workspaceName !== "string" ||
        !data.workspaceName.trim() ||
        data.workspaceName.trim().length > 50 ||
        typeof data.alertsEnabled !== "boolean"
      )
        throw new Error(
          "400:이름은 1~50자, 알림 설정은 true/false여야 합니다.",
        );
      db.exec("BEGIN");
      try {
        const stmt = db.prepare("UPDATE settings SET value=? WHERE key=?");
        stmt.run(data.workspaceName.trim(), "workspaceName");
        stmt.run(String(data.alertsEnabled), "alertsEnabled");
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return json(res, settings());
    }
    if (p === "/api/export" && req.method === "GET") {
      const d = analytics(filters(url.searchParams));
      const rows = [
        ["항목", "값", "시작일", "종료일", "점포 ID", "채널"],
        ...Object.entries({
          "매출(원)": d.summary.sales,
          "완료 주문": d.summary.orders,
          "활성 고객": d.summary.activeCustomers,
          "캠페인 대상": d.campaigns.target,
          "캠페인 구매 고객": d.campaigns.converted,
          "캠페인 전환율(%)": d.campaigns.conversion ?? "",
          "예산(원)": d.budget.planned,
          "집행(원)": d.budget.spent,
          "앱 활성 사용자": d.app.users,
        }).map(([k, v]) => [
          k,
          v,
          d.range.start,
          d.range.end,
          d.range.store || "전체",
          d.range.channel || "전체",
        ]),
      ];
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="hyundai-dw-summary.csv"',
        "Cache-Control": "no-store",
      });
      return res.end(
        "\uFEFF" +
          rows
            .map((r) =>
              r
                .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
                .join(","),
            )
            .join("\r\n"),
      );
    }
    if (p.startsWith("/api/"))
      return json(res, { error: "API 경로 또는 메서드를 확인하세요." }, 404);
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, { error: "지원하지 않는 요청입니다." }, 405);
    let path = resolve(dist, "." + decodeURIComponent(p));
    if (!path.startsWith(dist + sep) && path !== dist)
      return json(res, { error: "잘못된 경로입니다." }, 400);
    try {
      if (!(await stat(path)).isFile()) path = resolve(dist, "index.html");
    } catch {
      path = resolve(dist, "index.html");
    }
    let data;
    try {
      data = await readFile(path);
    } catch {
      return json(
        res,
        {
          error:
            "먼저 npm run build를 실행하거나 npm run dev로 개발 서버를 시작하세요.",
        },
        404,
      );
    }
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (e) {
    const bad = String(e.message).startsWith("400:");
    if (!bad) console.error(e);
    json(
      res,
      {
        error: bad
          ? e.message.slice(4)
          : "데이터 조회에 실패했습니다. 서버 로그를 확인하세요.",
      },
      bad ? 400 : 500,
    );
  }
});
const port = Number(process.env.PORT || 3001);
server.listen(port, "127.0.0.1", () => {
  console.log(`DW API + SQLite: http://localhost:${server.address().port}`);
  process.send?.({ type: "dw-ready" });
});
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `포트 ${port}가 사용 중입니다. 기존 DW 서버를 종료해 주세요.`
      : e,
  );
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
