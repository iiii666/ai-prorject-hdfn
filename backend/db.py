import asyncio
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

import asyncmy
from asyncmy.cursors import DictCursor

from .config import ROOT

TABLES = [
    "stores",
    "products",
    "customers",
    "campaigns",
    "campaign_targets",
    "orders",
    "order_items",
    "payments",
    "app_sessions",
    "campaign_spend",
    "budget_daily",
    "settings",
    "seed_info",
    "pipeline_runs",
    "asset_metadata",
    "asset_edges",
]
pool = None


def normalize(sql):
    sql = re.sub(r"\bAS INTEGER\b", "AS SIGNED", sql, flags=re.I)
    sql = re.sub(r"\bAS TEXT\b", "AS CHAR", sql, flags=re.I)
    sql = re.sub(r"(?<!`)\bkey\b(?!`)", "`key`", sql)
    return sql.replace("%", "%%").replace("?", "%s")


def values(row):
    return {
        k: (int(v) if v == v.to_integral_value() else float(v))
        if isinstance(v, Decimal)
        else v
        for k, v in row.items()
    }


async def connect():
    global pool
    pool = await asyncmy.create_pool(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "dw_app"),
        password=os.getenv("DB_PASSWORD", "dw_local_password"),
        db=os.getenv("DB_DATABASE", "hyundai_dw"),
        minsize=1,
        maxsize=6,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=10,
    )


async def close():
    global pool
    if pool:
        pool.close()
        await pool.wait_closed()
        pool = None


async def all(sql, args=()):
    async with pool.acquire() as conn:
        async with conn.cursor(DictCursor) as cur:
            await cur.execute(normalize(sql), args)
            return [values(r) for r in await cur.fetchall()]


async def one(sql, args=()):
    rows = await all(sql, args)
    return rows[0] if rows else None


@asynccontextmanager
async def transaction():
    async with pool.acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                yield cur
            await conn.commit()
        except BaseException:
            await conn.rollback()
            raise


async def table_names():
    return await all(
        "SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"
    )


async def columns(name):
    return await all(
        "SELECT COLUMN_NAME name,COLUMN_TYPE type,CASE WHEN COLUMN_KEY='PRI' THEN 1 ELSE 0 END pk FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
        [name],
    )


async def count_rows(name):
    if not re.fullmatch("[a-z_]+", name):
        raise ValueError("Invalid table identifier")
    return await one(f"SELECT COUNT(*) count FROM `{name}`")


def import_sqlite(path):
    with sqlite3.connect(
        Path(path).resolve().as_uri() + "?mode=ro", uri=True
    ) as source:
        source.row_factory = sqlite3.Row
        return {
            name: [dict(r) for r in source.execute(f"SELECT * FROM {name}")]
            for name in TABLES
        }


async def initialize():
    async with pool.acquire() as conn:
        locked = False
        try:
            async with conn.cursor(DictCursor) as cur:
                await cur.execute(
                    "SELECT GET_LOCK(CONCAT(DATABASE(),':initialize'),120) acquired"
                )
                locked = (await cur.fetchone())["acquired"] == 1
                if not locked:
                    raise RuntimeError("DB initialization lock unavailable")
                for stmt in (
                    (ROOT / "backend/schema.sql").read_text(encoding="utf-8").split(";")
                ):
                    if stmt.strip():
                        await cur.execute(stmt)
                await cur.execute("SELECT COUNT(*) count FROM seed_info")
                if (await cur.fetchone())["count"]:
                    return
                await cur.execute(
                    "SELECT (SELECT COUNT(*) FROM orders)+(SELECT COUNT(*) FROM customers)+(SELECT COUNT(*) FROM settings) count"
                )
                if (await cur.fetchone())["count"]:
                    raise RuntimeError(
                        "기존 데이터가 있는 DB에는 자동 샘플을 혼합하지 않습니다. 별도 빈 DB를 선택하세요."
                    )
                if os.getenv("DB_IMPORT_SQLITE"):
                    data = await asyncio.to_thread(
                        import_sqlite, os.environ["DB_IMPORT_SQLITE"]
                    )
                else:
                    from .seed_data import generate

                    data = await asyncio.to_thread(generate)
                await conn.begin()
                try:
                    for name in TABLES:
                        rows = data[name]
                        if not rows:
                            continue
                        keys = list(rows[0])
                        query = (
                            f"INSERT INTO `{name}` ("
                            + ",".join(f"`{k}`" for k in keys)
                            + ") VALUES ("
                            + ",".join(["%s"] * len(keys))
                            + ")"
                        )
                        for i in range(0, len(rows), 500):
                            await cur.executemany(
                                query,
                                [[row[k] for k in keys] for row in rows[i : i + 500]],
                            )
                    await conn.commit()
                except BaseException:
                    await conn.rollback()
                    raise
        finally:
            if locked:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT RELEASE_LOCK(CONCAT(DATABASE(),':initialize'))"
                    )
