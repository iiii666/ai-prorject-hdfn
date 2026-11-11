import asyncio
import json
from contextlib import asynccontextmanager

import httpx
import pytest

from backend import custom, db
from backend.app import app


@pytest.fixture
async def client(database, monkeypatch):
    class Cursor:
        async def execute(self, sql, args):
            database.execute(sql.replace("%s", "?"), args)

    @asynccontextmanager
    async def transaction():
        yield Cursor()

    monkeypatch.setattr(db, "transaction", transaction)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client
    finally:
        database.rollback()


async def test_routes(client):
    for path in [
        "/api/health",
        "/api/bootstrap",
        "/api/analytics",
        "/api/orders",
        "/api/custom/status",
    ]:
        response = await client.get(path)
        assert response.status_code == 200, (path, response.text)
        assert response.headers["cache-control"] == "no-store"
    response = await client.get("/api/export")
    assert response.content.startswith(b"\xef\xbb\xbf")
    assert "hyundai-dw-summary.csv" in response.headers["content-disposition"]
    assert '"항목","값"' in response.text


@pytest.mark.parametrize(
    "method,path,status",
    [
        ("GET", "/api/unknown", 404),
        ("POST", "/api/analytics", 404),
        ("GET", "/api/analytics?days=0", 400),
        ("PATCH", "/api/settings", 400),
    ],
)
async def test_errors(client, method, path, status):
    r = await client.request(method, path)
    assert r.status_code == status and set(r.json()) == {"error"}


async def test_settings_and_body(client):
    r = await client.patch(
        "/api/settings", json={"workspaceName": "테스트", "alertsEnabled": False}
    )
    assert r.status_code == 200 and r.json() == {
        "workspaceName": "테스트",
        "alertsEnabled": False,
        "historyVersion": "1",
        "operationalStart": "2024-01-01",
        "operationalHistoryVersion": "1",
    }
    for raw in ["{", "[]", json.dumps({"workspaceName": "a" * 5000})]:
        assert (await client.patch("/api/settings", content=raw)).status_code == 400


async def test_origin(client):
    r = await client.post(
        "/api/custom/analyze", headers={"origin": "http://elsewhere"}, json={}
    )
    assert r.status_code == 403


async def test_static(client, monkeypatch, tmp_path):
    import importlib

    module = importlib.import_module("backend.app")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist/index.html").write_text("<html>React test</html>")
    assert (await client.get("/dashboard")).status_code == 200
    head = await client.head("/dashboard")
    assert head.status_code == 200 and not head.content


async def test_analysis_does_not_block_queries(client, monkeypatch):
    entered = asyncio.Event()
    release = asyncio.Event()

    async def analysis(input):
        entered.set()
        await release.wait()
        return {"report": {}}

    monkeypatch.setattr(custom, "custom_analysis", analysis)
    task = asyncio.create_task(
        client.post("/api/custom/analyze", json={"question": "매출 분석"})
    )
    await entered.wait()
    r = await asyncio.wait_for(client.get("/api/bootstrap"), timeout=2)
    assert r.status_code == 200
    release.set()
    assert (await task).status_code == 200
