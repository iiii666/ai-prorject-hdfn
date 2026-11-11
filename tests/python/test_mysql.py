"""Use an isolated DB: DB_PORT=33316 ... pytest --mysql. Never deletes data."""

import httpx
import pytest
from test_parity import LEGACY, stable

from backend import analytics, custom, db
from backend.app import app, lifespan


@pytest.fixture
async def mysql(request):
    if not request.config.getoption("--mysql"):
        pytest.skip("use --mysql with an isolated database")
    async with lifespan(app):
        yield


async def test_mysql_parity_and_initialize(mysql):
    assert (await db.one("SELECT VERSION() version"))["version"].startswith("8.4.")
    count = (await db.one("SELECT COUNT(*) n FROM orders"))["n"]
    await db.initialize()
    assert (await db.one("SELECT COUNT(*) n FROM orders"))["n"] == count
    from urllib.parse import parse_qsl

    for case in LEGACY["cases"]:
        params = dict(parse_qsl(case["query"]))
        f = await analytics.filters(params)
        assert stable(await analytics.analytics(f)) == stable(case["analytics"])
        assert await analytics.order_list(f, params) == case["orders"]
    for case in LEGACY["forecasts"]:
        assert stable(await custom.forecast(case["input"])) == stable(case["result"])
    catalog = await analytics.catalog()
    assert len(catalog["assets"]) == 16
    assert next(a for a in catalog["assets"] if a["id"] == "orders")["rows"] == count
    assert any(
        c["name"] == "id" and c["pk"] == 1
        for c in next(a for a in catalog["assets"] if a["id"] == "orders")["columns"]
    )


async def test_mysql_transactions_and_http(mysql):
    with pytest.raises(Exception):
        async with db.transaction() as cur:
            await cur.execute(
                "INSERT INTO orders VALUES (987654321,-1,1,'오프라인','2026-11-10','completed',NULL)"
            )
    previous = await analytics.settings()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        try:
            r = await client.patch(
                "/api/settings",
                json=dict(workspaceName="Python 검증", alertsEnabled=False),
            )
            assert r.status_code == 200
            assert (await analytics.settings())["workspaceName"] == "Python 검증"
            for path in [
                "/api/health",
                "/api/bootstrap",
                "/api/analytics",
                "/api/catalog",
                "/api/orders",
                "/api/export",
                "/api/custom/status",
            ]:
                assert (await client.get(path)).status_code == 200
        finally:
            await client.patch(
                "/api/settings",
                json={k: previous[k] for k in ["workspaceName", "alertsEnabled"]},
            )
    assert await analytics.settings() == previous
