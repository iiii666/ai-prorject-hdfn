import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError
from starlette.exceptions import HTTPException

from . import analytics, custom, db
from .common import AnalysisError, fail
from .config import ROOT
from .models import SettingsInput


@asynccontextmanager
async def lifespan(app):
    try:
        await db.connect()
        await db.initialize()
        yield
    finally:
        await db.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(AnalysisError)
async def analysis_error(request, exc):
    return JSONResponse({"error": str(exc)}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse({"error": "JSON 요청이 올바르지 않습니다."}, status_code=400)


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse(
        {
            "error": "API 경로 또는 메서드를 확인하세요."
            if request.url.path.startswith("/api/")
            else "지원하지 않는 요청입니다."
        },
        status_code=404 if request.url.path.startswith("/api/") else exc.status_code,
    )


@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    logging.getLogger(__name__).exception("데이터 조회 실패")
    return JSONResponse(
        {"error": "데이터 조회에 실패했습니다. 서버 로그를 확인하세요."},
        status_code=500,
    )


@app.middleware("http")
async def no_cache(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = (
        "no-store" if request.url.path.startswith("/api/") else "no-cache"
    )
    return response


async def body(request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 4096:
            fail("요청이 너무 큽니다.")
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeDecodeError):
        fail("JSON 요청이 올바르지 않습니다.")


@app.get("/api/health")
async def health():
    return dict(
        status="ok", database="MySQL", seed=await db.one("SELECT * FROM seed_info")
    )


@app.get("/api/bootstrap")
async def bootstrap():
    return await analytics.bootstrap()


@app.get("/api/analytics")
async def analysis(request: Request):
    return await analytics.analytics(await analytics.filters(request.query_params))


@app.get("/api/catalog")
async def catalog():
    return await analytics.catalog()


@app.get("/api/orders")
async def orders(request: Request):
    return await analytics.order_list(
        await analytics.filters(request.query_params), request.query_params
    )


@app.patch("/api/settings")
async def settings(request: Request):
    data = await body(request)
    try:
        validated = SettingsInput.model_validate(data)
    except ValidationError:
        fail("이름은 1~50자, 알림 설정은 true/false여야 합니다.")
    name, alerts = validated.workspaceName, validated.alertsEnabled
    async with db.transaction() as cur:
        await cur.execute(
            "UPDATE settings SET value=%s WHERE `key`=%s",
            [name.strip(), "workspaceName"],
        )
        await cur.execute(
            "UPDATE settings SET value=%s WHERE `key`=%s",
            [str(alerts).lower(), "alertsEnabled"],
        )
    return await analytics.settings()


@app.get("/api/custom/status")
async def custom_status():
    return await custom.custom_status()


@app.post("/api/custom/analyze")
async def custom_analysis(request: Request):
    origin = request.headers.get("origin")
    if origin and origin != f"http://{request.headers.get('host')}":
        fail("같은 사이트에서만 분석을 요청할 수 있습니다.", 403)
    return await custom.custom_analysis(await body(request))


@app.get("/api/export")
async def export(request: Request):
    d = await analytics.analytics(await analytics.filters(request.query_params))
    values = {
        "매출(원)": d["summary"]["sales"],
        "완료 주문": d["summary"]["orders"],
        "활성 고객": d["summary"]["activeCustomers"],
        "캠페인 대상": d["campaigns"]["target"],
        "캠페인 구매 고객": d["campaigns"]["converted"],
        "캠페인 전환율(%)": d["campaigns"]["conversion"],
        "예산(원)": d["budget"]["planned"],
        "집행(원)": d["budget"]["spent"],
        "앱 활성 사용자": d["app"]["users"],
    }
    rows = [["항목", "값", "시작일", "종료일", "점포 ID", "채널"]] + [
        [
            k,
            v,
            d["range"]["start"],
            d["range"]["end"],
            d["range"]["store"] or "전체",
            d["range"]["channel"] or "전체",
        ]
        for k, v in values.items()
    ]

    def cell(v):
        text = "" if v is None else format(v, "g") if isinstance(v, float) else str(v)
        return '"' + text.replace('"', '""') + '"'

    content = "\ufeff" + "\r\n".join(",".join(cell(v) for v in row) for row in rows)
    return Response(
        content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="hyundai-dw-summary.csv"'
        },
    )


@app.api_route(
    "/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
)
async def static(request: Request, path: str):
    if path.startswith("api/"):
        fail("API 경로 또는 메서드를 확인하세요.", 404)
    if request.method not in ["GET", "HEAD"]:
        fail("지원하지 않는 요청입니다.", 405)
    dist = (ROOT / "dist").resolve()
    target = (dist / path).resolve()
    if not target.is_relative_to(dist):
        fail("잘못된 경로입니다.", 400)
    if not target.is_file():
        target = dist / "index.html"
    if not target.is_file():
        fail(
            "먼저 npm run build를 실행하거나 npm run dev로 개발 서버를 시작하세요.", 404
        )
    return FileResponse(target)
