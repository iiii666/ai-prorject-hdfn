"""Deterministic sample rows, generated directly in Python (no intermediate DB)."""

import calendar
import json
import math
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .common import date_add, js_round, stamp


class Random:
    def __init__(self, state):
        self.state = state

    def __call__(self):
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 4294967296

    def integer(self, a, b):
        return a + math.floor(self() * (b - a + 1))

    def pick(self, items):
        return items[self.integer(0, len(items) - 1)]


def generate():
    from .db import TABLES

    data = {k: [] for k in TABLES}

    def add(table, columns, *values):
        data[table].append(dict(zip(columns.split(","), values)))

    r = Random(20261109)
    end = (
        os.getenv("DW_SEED_END")
        or datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    )
    start = date_add(end, -209)
    timestamp = stamp()
    for i, name in enumerate(["더현대 서울", "압구정본점", "판교점"], 1):
        add("stores", "id,name", i, name)
    categories = ["패션", "식품", "리빙", "뷰티"]
    prices = [69000, 18000, 85000, 42000]
    for i in range(1, 49):
        c = (i - 1) % 4
        add(
            "products",
            "id,name,category,price",
            i,
            f"{categories[c]} 샘플 상품 {i:02}",
            categories[c],
            prices[c] * r.integer(1, 4),
        )
    customers = []
    for i in range(1, 3601):
        n = r()
        d = date_add(start, 0 if i <= 180 else r.integer(0, 206))
        store = r.integer(1, 3)
        grade = (
            "일반" if n < 0.54 else "실버" if n < 0.8 else "골드" if n < 0.94 else "VIP"
        )
        customers.append(dict(id=i, date=d, store=store, grade=grade))
        add(
            "customers",
            "id,name,grade,joined_at,home_store_id",
            i,
            f"샘플고객 {i:04}",
            grade,
            d,
            store,
        )
    defs = []
    targets = {}
    tid = 0
    for i, (name, channel, a, b) in enumerate(
        [
            ("재방문 쇼핑 쿠폰", "모바일 앱", -150, 0),
            ("신규 고객 웰컴", "모바일 앱", -209, 30),
            ("앱 푸시 재구매", "모바일 앱", -100, 14),
            ("VIP 프라이빗 초대", "오프라인", -65, -10),
            ("주말 쇼핑 리워드", "오프라인", -90, 7),
            ("시즌 감사 페스티벌", "오프라인", -209, -100),
        ],
        1,
    ):
        c = dict(
            id=i,
            name=name,
            channel=channel,
            start=date_add(end, a),
            end=date_add(end, b),
        )
        defs.append(c)
        add(
            "campaigns",
            "id,name,channel,start_date,end_date",
            i,
            name,
            channel,
            c["start"],
            c["end"],
        )
        for u in customers:
            if r() > 0.48 or u["date"] > c["end"] or (i == 4 and u["grade"] != "VIP"):
                continue
            lower = max(u["date"], c["start"])
            upper = min(c["end"], end)
            if lower > upper:
                continue
            span = (date.fromisoformat(upper) - date.fromisoformat(lower)).days
            d = date_add(lower, r.integer(0, span))
            tid += 1
            t = dict(
                id=tid,
                campaign=i,
                date=d,
                end=c["end"],
                channel=channel,
                store=u["store"],
            )
            add(
                "campaign_targets",
                "id,campaign_id,customer_id,store_id,channel,targeted_at",
                tid,
                i,
                u["id"],
                u["store"],
                channel,
                d,
            )
            targets.setdefault(u["id"], []).append(t)
    oid = iid = sid = 0
    for d in range(210):
        day = date_add(start, d)
        eligible = [c for c in customers if c["date"] <= day]
        count = (
            r.integer(110, 180)
            + math.floor(d * 0.35)
            + (45 if date.fromisoformat(day).weekday() in [5, 6] else 0)
        )
        for _ in range(count):
            u = r.pick(eligible)
            channel = "모바일 앱" if r() < 0.58 else "오프라인"
            store = u["store"] if r() < 0.8 else r.integer(1, 3)
            candidates = [
                t
                for t in targets.get(u["id"], [])
                if t["channel"] == channel
                and t["store"] == store
                and t["date"] <= day
                and t["end"] >= day
            ]
            t = r.pick(candidates) if candidates and r() < 0.6 else None
            status = "cancelled" if r() < 0.035 else "completed"
            oid += 1
            add(
                "orders",
                "id,customer_id,store_id,channel,ordered_at,status,campaign_target_id",
                oid,
                u["id"],
                store,
                channel,
                day,
                status,
                t["id"] if t else None,
            )
            amount = 0
            for _ in range(r.integer(1, 3)):
                p = r.pick(data["products"])
                qty = r.integer(1, 2)
                iid += 1
                add(
                    "order_items",
                    "id,order_id,product_id,quantity,unit_price",
                    iid,
                    oid,
                    p["id"],
                    qty,
                    p["price"],
                )
                amount += qty * p["price"]
            if status == "completed":
                add(
                    "payments",
                    "id,order_id,amount,method,paid_at",
                    oid,
                    oid,
                    amount,
                    r.pick(["신용카드", "현대백화점 상품권", "간편결제"]),
                    day,
                )
                if channel == "모바일 앱":
                    sid += 1
                    add(
                        "app_sessions",
                        "id,customer_id,store_id,session_date,duration_seconds,viewed_product,added_cart,order_id",
                        sid,
                        u["id"],
                        store,
                        day,
                        r.integer(80, 840),
                        1,
                        1,
                        oid,
                    )
        for _ in range(r.integer(160, 300)):
            u = r.pick(eligible)
            view = 1 if r() < 0.78 else 0
            cart = 1 if view and r() < 0.35 else 0
            sid += 1
            add(
                "app_sessions",
                "id,customer_id,store_id,session_date,duration_seconds,viewed_product,added_cart,order_id",
                sid,
                u["id"],
                u["store"],
                day,
                r.integer(10, 720),
                view,
                cart,
                None,
            )
    for d in range(210):
        day = date_add(start, d)
        for s in range(1, 4):
            for channel in ["모바일 앱", "오프라인"]:
                cp = cs = 0
                for c in [
                    c
                    for c in defs
                    if c["start"] <= day <= c["end"] and c["channel"] == channel
                ]:
                    p = r.integer(60000, 140000)
                    v = js_round(p * (0.5 + r() * 0.55))
                    cp += p
                    cs += v
                    add(
                        "campaign_spend",
                        "campaign_id,store_id,channel,date,planned,spent",
                        c["id"],
                        s,
                        channel,
                        day,
                        p,
                        v,
                    )
                add(
                    "budget_daily",
                    "date,store_id,channel,department,planned,spent,sales_target",
                    day,
                    s,
                    channel,
                    "CRM 캠페인",
                    cp,
                    cs,
                    r.integer(1500000, 2500000),
                )
                for dep in ["디지털 마케팅", "점포 프로모션"]:
                    p = r.integer(140000, 260000)
                    add(
                        "budget_daily",
                        "date,store_id,channel,department,planned,spent,sales_target",
                        day,
                        s,
                        channel,
                        dep,
                        p,
                        js_round(p * (0.45 + r() * 0.5)),
                        r.integer(5000000, 8500000),
                    )
    add("settings", "key,value", "workspaceName", "현대백화점 DW")
    add("settings", "key,value", "alertsEnabled", "true")
    add(
        "seed_info",
        "id,version,start_date,end_date,created_at",
        1,
        1,
        start,
        end,
        timestamp,
    )
    for i, name, n in [
        (1, "고객·상품 기준정보 생성", 3648),
        (2, "주문·결제 샘플 적재", oid),
        (3, "앱 세션 적재", sid),
        (4, "캠페인·예산 적재", len(data["budget_daily"]) + tid),
    ]:
        add(
            "pipeline_runs",
            "id,name,status,finished_at,processed_rows",
            i,
            name,
            "success",
            timestamp,
            n,
        )
    data.update(
        json.loads(
            Path(__file__).with_name("catalog_seed.json").read_text(encoding="utf-8")
        )
    )
    extend(data, add, start, end)
    for session in data["app_sessions"]:
        session["channel"] = "모바일 앱"
    return data


def extend(data, add, original_start, end):
    start = f"{int(end[:4]) - 2}-01-01"
    if start >= original_start:
        return
    r = Random(4291)
    oid = len(data["orders"])
    iid = len(data["order_items"])
    count = 0
    for c in data["customers"]:
        if c["id"] <= 2400 and c["joined_at"] > start:
            c["joined_at"] = start
    day = start
    while day < original_start:
        month = int(day[5:7])
        season = [0.85, 0.95, 1.05, 1, 1.12, 0.9, 0.85, 0.92, 1.18, 1.1, 1.3, 1.45][
            month - 1
        ]
        trend = 1 + (date.fromisoformat(day) - date.fromisoformat(start)).days / 3000
        for _ in range(js_round((48 + r() * 25) * season * trend)):
            customer = 1 + math.floor(r() * 2400)
            store = 1 + math.floor(r() * 3)
            channel = "모바일 앱" if r() < 0.58 else "오프라인"
            oid += 1
            add(
                "orders",
                "id,customer_id,store_id,channel,ordered_at,status,campaign_target_id",
                oid,
                customer,
                store,
                channel,
                day,
                "completed",
                None,
            )
            amount = 0
            for _ in range(1 + math.floor(r() * 2)):
                p = data["products"][math.floor(r() * len(data["products"]))]
                qty = 1 + math.floor(r() * 2)
                iid += 1
                add(
                    "order_items",
                    "id,order_id,product_id,quantity,unit_price",
                    iid,
                    oid,
                    p["id"],
                    qty,
                    p["price"],
                )
                amount += qty * p["price"]
            add(
                "payments",
                "id,order_id,amount,method,paid_at",
                oid,
                oid,
                amount,
                "신용카드",
                day,
            )
            count += 1
        day = date_add(day, 1)
    data["seed_info"][0]["start_date"] = start
    add("settings", "key,value", "historyVersion", "1")
    add("settings", "key,value", "operationalStart", original_start)
    data["pipeline_runs"][1]["processed_rows"] += count
    r = Random(7349)
    cid = len(data["campaigns"])
    tid = len(data["campaign_targets"])
    sid = len(data["app_sessions"])
    sessions = targets = 0
    defs = {}
    orders = sorted(
        [
            o
            for o in data["orders"]
            if start <= o["ordered_at"] < original_start and o["status"] == "completed"
        ],
        key=lambda o: (o["ordered_at"], o["id"]),
    )
    for o in orders:
        y = int(o["ordered_at"][:4])
        quarter = (int(o["ordered_at"][5:7]) - 1) // 3
        key = (y, quarter, o["channel"])
        if key not in defs:
            a = f"{y}-{quarter * 3 + 1:02}-01"
            m = quarter * 3 + 3
            b = f"{y}-{m:02}-{calendar.monthrange(y, m)[1]}"
            cid += 1
            c = dict(id=cid, start=a, end=b, channel=o["channel"])
            defs[key] = c
            name = (
                f"{y} {['봄맞이', '패밀리', '가을 재방문', '연말 감사'][quarter]} "
                + ("앱 쿠폰" if o["channel"] == "모바일 앱" else "점포 초대")
            )
            add(
                "campaigns",
                "id,name,channel,start_date,end_date",
                cid,
                name,
                c["channel"],
                a,
                b,
            )
        if o["channel"] == "모바일 앱":
            sid += 1
            sessions += 1
            add(
                "app_sessions",
                "id,customer_id,store_id,session_date,duration_seconds,viewed_product,added_cart,order_id",
                sid,
                o["customer_id"],
                o["store_id"],
                o["ordered_at"],
                120 + math.floor(r() * 600),
                1,
                1,
                o["id"],
            )
    for c in defs.values():
        assigned = {}
        for o in [
            o
            for o in orders
            if o["channel"] == c["channel"]
            and c["start"] <= o["ordered_at"] <= c["end"]
        ]:
            if o["customer_id"] not in assigned and r() < 0.3:
                tid += 1
                targets += 1
                t = dict(id=tid, store=o["store_id"])
                assigned[o["customer_id"]] = t
                add(
                    "campaign_targets",
                    "id,campaign_id,customer_id,store_id,channel,targeted_at",
                    tid,
                    c["id"],
                    o["customer_id"],
                    t["store"],
                    c["channel"],
                    c["start"],
                )
            t = assigned.get(o["customer_id"])
            if (
                t
                and t["store"] == o["store_id"]
                and r() < 0.5
                and o["campaign_target_id"] is None
            ):
                o["campaign_target_id"] = t["id"]
        for u in range(1, 2401):
            if u not in assigned and r() < 0.32:
                tid += 1
                targets += 1
                add(
                    "campaign_targets",
                    "id,campaign_id,customer_id,store_id,channel,targeted_at",
                    tid,
                    c["id"],
                    u,
                    1 + math.floor(r() * 3),
                    c["channel"],
                    c["start"],
                )
    day = start
    while day < original_start:
        for store in range(1, 4):
            for _ in range(32):
                view = 1 if r() < 0.76 else 0
                sid += 1
                sessions += 1
                add(
                    "app_sessions",
                    "id,customer_id,store_id,session_date,duration_seconds,viewed_product,added_cart,order_id",
                    sid,
                    1 + math.floor(r() * 2400),
                    store,
                    day,
                    20 + math.floor(r() * 480),
                    view,
                    1 if view and r() < 0.3 else 0,
                    None,
                )
            for channel in ["모바일 앱", "오프라인"]:
                planned = spent = 0
                for c in [
                    c
                    for c in defs.values()
                    if c["channel"] == channel and c["start"] <= day <= c["end"]
                ]:
                    p = 60000 + math.floor(r() * 60000)
                    v = js_round(p * (0.5 + r() * 0.4))
                    planned += p
                    spent += v
                    add(
                        "campaign_spend",
                        "campaign_id,store_id,channel,date,planned,spent",
                        c["id"],
                        store,
                        channel,
                        day,
                        p,
                        v,
                    )
                add(
                    "budget_daily",
                    "date,store_id,channel,department,planned,spent,sales_target",
                    day,
                    store,
                    channel,
                    "CRM 캠페인",
                    planned,
                    spent,
                    400000,
                )
                for name in ["디지털 마케팅", "점포 프로모션"]:
                    p = 100000 + math.floor(r() * 60000)
                    add(
                        "budget_daily",
                        "date,store_id,channel,department,planned,spent,sales_target",
                        day,
                        store,
                        channel,
                        name,
                        p,
                        js_round(p * (0.5 + r() * 0.35)),
                        650000,
                    )
        day = date_add(day, 1)
    add("settings", "key,value", "operationalHistoryVersion", "1")
    for s in data["settings"]:
        if s["key"] == "operationalStart":
            s["value"] = start
    for i, n in [(2, sessions), (3, targets)]:
        data["pipeline_runs"][i]["processed_rows"] += n
        data["pipeline_runs"][i]["finished_at"] = stamp()
