import json
from pathlib import Path
from urllib.parse import parse_qsl

import pytest

from backend import analytics, custom
from backend.common import AnalysisError, date_add, js_round

LEGACY = json.loads((Path(__file__).parents[1] / "fixtures/legacy.json").read_text())


def stable(obj):
    if isinstance(obj, dict):
        return {
            k: stable(v)
            for k, v in obj.items()
            if k not in ["created_at", "finished_at", "queriedAt"]
        }
    if isinstance(obj, list):
        return [stable(v) for v in obj]
    return obj


@pytest.mark.parametrize("case", LEGACY["cases"])
async def test_analytics_parity(database, case):
    params = dict(parse_qsl(case["query"]))
    f = await analytics.filters(params)
    assert stable(await analytics.analytics(f)) == stable(case["analytics"])
    assert await analytics.order_list(f, params) == case["orders"]


@pytest.mark.parametrize("case", LEGACY["forecasts"])
async def test_forecast_parity(database, case):
    assert stable(await custom.forecast(case["input"])) == stable(case["result"])


async def test_bootstrap(database):
    assert stable(await analytics.bootstrap()) == stable(LEGACY["bootstrap"])


@pytest.mark.parametrize(
    "params",
    [
        {"days": "0"},
        {"end": "2026-02-30"},
        {"store": "4"},
        {"channel": "bad"},
        {"start": "2020-01-01", "end": "2021-01-01"},
    ],
)
async def test_invalid_filters(database, params):
    with pytest.raises(AnalysisError):
        await analytics.filters(params)


def test_rounding_and_dates():
    assert js_round(0.49999999999999994) == 0
    assert js_round(2.5) == 3
    assert js_round(-1.5) == -1
    assert date_add("2024-02-28", 1) == "2024-02-29"


async def test_missing_forecast_year(database):
    with pytest.raises(AnalysisError):
        await custom.forecast({})
