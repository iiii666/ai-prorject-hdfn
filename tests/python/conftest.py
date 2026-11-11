import sqlite3
from pathlib import Path

import pytest

from backend import db
from backend.seed_data import generate


@pytest.fixture(scope="session")
def sample_data():
    import os

    old = os.environ.get("DW_SEED_END")
    os.environ["DW_SEED_END"] = "2026-11-10"
    try:
        return generate()
    finally:
        if old is None:
            os.environ.pop("DW_SEED_END", None)
        else:
            os.environ["DW_SEED_END"] = old


@pytest.fixture(scope="session")
def sample_db(sample_data):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    schema = (Path(__file__).parents[2] / "tests/fixtures/schema.sql").read_text()
    conn.executescript(schema)
    for name in db.TABLES:
        rows = sample_data[name]
        if rows:
            keys = list(rows[0])
            conn.executemany(
                f"INSERT INTO {name} ("
                + ",".join('"' + k + '"' for k in keys)
                + ") VALUES ("
                + ",".join("?" for _ in keys)
                + ")",
                [[r[k] for k in keys] for r in rows],
            )
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def database(sample_db, monkeypatch):
    async def all(sql, args=()):
        return [dict(r) for r in sample_db.execute(sql, args)]

    async def one(sql, args=()):
        return next(iter(await all(sql, args)), None)

    monkeypatch.setattr(db, "all", all)
    monkeypatch.setattr(db, "one", one)
    return sample_db


def pytest_addoption(parser):
    parser.addoption(
        "--mysql", action="store_true", help="Run against a disposable MySQL database"
    )
