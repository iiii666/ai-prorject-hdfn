import asyncio
import calendar
import json
import math
import os
import re
import time
import unicodedata
from datetime import date
from pathlib import Path

from jsonschema import ValidationError, validate
from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from . import db
from .analytics import scope
from .common import fail, js_round, number, stamp
from .config import model
from .evidence import build_evidence
from .prompts import CORRECTION_PROMPT, REPORT_PROMPT, SCOPE_PROMPT

SCHEMAS = json.loads(
    Path(__file__).with_name("schemas.json").read_text(encoding="utf-8")
)
PLAN_SCHEMA = SCHEMAS["planSchema"]
REPORT_SCHEMA = SCHEMAS["reportSchema"]
lock = asyncio.Lock()
requests = []


def guard_question(value):
    if not isinstance(value, str) or len(value.strip()) < 5 or len(value) > 1000:
        fail("질문은 5~1,000자로 입력하세요.")
    q = re.sub(
        "[\u200b-\u200f\ufeff]", "", unicodedata.normalize("NFKC", value)
    ).strip()
    if re.search(
        r"ignore|disregard|jailbreak|system\s*(prompt|message)|developer\s*message|시스템\s*(프롬프트|메시지)|지침.*무시|명령.*무시|이전.*무시|프롬프트.*(공개|출력|알려)|api.?key|비밀.?키|비밀번호|주민.?번호|전화.?번호|이메일|개인정보|고객\s*명단|원본.*(전부|모두)|select\s|drop\s|delete\s|insert\s|update\s|alter\s|삭제|수정해|변경해|실행해|해킹|폭탄|살인|자살|음란|야동|정치|대통령|날씨|레시피|운세|주식|비트코인|password|secret|phone|email|weather|recipe|politic",
        q,
        re.I,
    ):
        fail(
            "이 기능은 DW 집계 분석 전용입니다. 무관한 질문, 개인정보·비밀정보 조회, 지침 우회 및 데이터 변경 요청은 처리하지 않습니다."
        )
    if not re.search(
        "매출|고객|캠페인|이벤트|예산|구매|상품|점포|전환|방문|앱|sales|revenue|campaign|budget|customer",
        q,
        re.I,
    ):
        fail("매출·고객·캠페인·앱·예산 등 DW 데이터에 관한 질문을 입력하세요.")
    return q


async def custom_status():
    op = await db.one("SELECT value FROM settings WHERE key='operationalStart'")
    return dict(
        configured=bool(os.getenv("OPENAI_API_KEY")),
        model=model(),
        years=[
            r["year"]
            for r in await db.all(
                "SELECT DISTINCT CAST(substr(ordered_at,1,4) AS INTEGER) year FROM dw_fact_orders ORDER BY year DESC"
            )
        ],
        seed=await db.one("SELECT * FROM seed_info"),
        operationalStart=op["value"] if op else None,
    )


async def forecast(input):
    status = await custom_status()
    year = number(input.get("year"))
    uplift = number(input.get("uplift", 5))
    store = input.get("store", "")
    channel = input.get("channel", "")
    if not year.is_integer() or year not in status["years"]:
        fail("DB에 존재하는 기준 연도를 선택하세요.")
    year = int(year)
    if store and str(store) not in [
        str(s["id"]) for s in await db.all("SELECT id FROM stores")
    ]:
        fail("점포를 확인하세요.")
    if channel and channel not in ["모바일 앱", "오프라인"]:
        fail("채널을 확인하세요.")
    if not math.isfinite(uplift) or not 0 <= uplift <= 20:
        fail("이벤트 효과 가정은 0~20% 범위입니다.")
    q, args = scope(dict(store=store, channel=channel))
    history = await db.all(
        f"SELECT substr(ordered_at,1,7) month,SUM(amount) sales,COUNT(*) orders FROM dw_fact_orders WHERE substr(ordered_at,1,4) IN (?,?){q} GROUP BY month ORDER BY month",
        [str(year - 1), str(year), *args],
    )
    coverage_start = status["seed"]["start_date"]
    coverage_end = status["seed"]["end_date"]

    def days(y, m):
        return calendar.monthrange(y, m)[1]

    def covered(y, m):
        s = max(f"{y}-{m:02}-01", coverage_start)
        e = min(f"{y}-{m:02}-{days(y, m)}", coverage_end)
        return 0 if s > e else (date.fromisoformat(e) - date.fromisoformat(s)).days + 1

    amounts = {r["month"]: r["sales"] for r in history}

    def get(y, m):
        return amounts.get(f"{y}-{m:02}", 0)

    now = prior = 0
    for m in range(1, 13):
        a, b = covered(year, m), covered(year - 1, m)
        if a == days(year, m) and b == days(year - 1, m):
            now += get(year, m) / a
            prior += get(year - 1, m) / b
    growth = max(-0.2, min(0.2, now / prior - 1)) if prior else 0
    total = sum(r["sales"] for r in history if r["month"].startswith(str(year)))
    observed = sum(covered(year, m) for m in range(1, 13))
    monthly = []
    for m in range(1, 13):
        a, b = covered(year, m), covered(year - 1, m)
        base = (
            get(year, m) / a
            if a
            else get(year - 1, m) / b
            if b
            else total / observed
            if observed
            else 0
        )
        baseline = js_round(base * days(year + 1, m) * (1 + growth))
        monthly.append(
            dict(
                month=f"{year + 1}-{m:02}",
                actualMonth=f"{year}-{m:02}",
                actual=get(year, m) if a else None,
                coveredDays=a,
                totalDays=days(year, m),
                baseline=baseline,
                conservative=js_round(baseline * 0.85),
                optimistic=js_round(baseline * 1.15),
                withEvent=js_round(baseline * (1 + uplift / 100)),
                source="기준 연도 일평균"
                if a
                else "전년도 동월 일평균"
                if b
                else "보유 기간 일평균",
            )
        )
    breakdown = await build_evidence(
        year=year,
        store=store,
        channel=channel,
        total=total,
        coverageStart=coverage_start,
        coverageEnd=coverage_end,
    )
    ya = [f"{year}-01-01", f"{year}-12-31", *args]
    customer = await db.one(
        f"SELECT COUNT(DISTINCT customer_id) activeCustomers,COUNT(*) orders FROM dw_fact_orders WHERE ordered_at BETWEEN ? AND ?{q}",
        ya,
    )
    app = await db.one(
        f"SELECT COUNT(*) sessions,COUNT(DISTINCT customer_id) users,COUNT(order_id) purchases FROM app_sessions WHERE session_date BETWEEN ? AND ?{q}",
        ya,
    )
    budget = await db.one(
        f"SELECT COALESCE(SUM(planned),0) planned,COALESCE(SUM(spent),0) spent,COALESCE(SUM(sales_target),0) salesTarget FROM budget_daily WHERE date BETWEEN ? AND ?{q}",
        ya,
    )
    limitations = [
        "모든 거래는 생성한 샘플 데이터입니다. 실제 매출 예측으로 사용하지 마세요.",
        "기준 연도 미보유 월은 전년도 동월 또는 보유 기간 일평균으로 대체합니다. 부분 월 실적은 실제 보유 일수로 나눕니다.",
        "성장률은 양쪽 연도 모두 완전히 보유한 월의 일평균 매출 비교이며 ±20%로 제한합니다.",
        "보수·낙관은 기준 예측의 ±15% 가정이며 통계적 신뢰구간이 아닙니다.",
        f"이벤트 효과 {uplift:g}%는 사용자가 지정한 가정으로, 캠페인의 인과 효과 추정이 아닙니다.",
        "과거 샘플 이력은 점포·상품·고객·캠페인·앱·예산을 포함합니다. 실제 외부 데이터가 아닙니다.",
    ]
    return dict(
        year=year,
        targetYear=year + 1,
        store=store,
        channel=channel,
        uplift=uplift,
        coverageStart=coverage_start,
        coverageEnd=coverage_end,
        operationalStart=status["operationalStart"],
        customerSummary=customer,
        appSummary=app,
        budgetSummary=budget,
        growth=js_round(growth * 10000) / 100,
        actualTotal=total,
        baselineTotal=sum(r["baseline"] for r in monthly),
        eventTotal=sum(r["withEvent"] for r in monthly),
        monthly=monthly,
        campaigns=breakdown["campaigns"],
        breakdown=breakdown,
        limitations=limitations,
    )


async def open_ai(system, input, schema, client=None):
    owned = client is None
    client = client or AsyncOpenAI(timeout=45.0, max_retries=0)
    try:
        try:
            async with asyncio.timeout(45):
                result = await client.responses.create(
                    model=model(),
                    store=False,
                    instructions=system,
                    input=json.dumps(input, ensure_ascii=False),
                    max_output_tokens=300 if schema == PLAN_SCHEMA else 4500,
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "dw_result",
                            "strict": True,
                            "schema": schema,
                        }
                    },
                )
        except APIStatusError as e:
            fail(
                "OpenAI API 키를 확인하세요."
                if e.status_code == 401
                else "OpenAI 사용 한도 또는 요청 제한을 확인하세요."
                if e.status_code == 429
                else "OpenAI 응답에 실패했습니다. 모델 설정을 확인하세요.",
                502,
            )
        except (APIConnectionError, TimeoutError):
            fail("OpenAI 연결이 지연되거나 실패했습니다. 잠시 후 다시 시도하세요.", 502)
        try:
            if result.status != "completed" or any(
                getattr(c, "type", None) == "refusal"
                for o in result.output
                for c in getattr(o, "content", [])
            ):
                raise ValueError()
            data = json.loads(result.output_text)
            validate(data, schema)
            return data
        except (ValueError, ValidationError, TypeError, AttributeError):
            fail("유효한 분석 응답을 받지 못했습니다. 다시 시도하세요.", 502)
    finally:
        if owned:
            await client.close()


def contradicts(report, evidence):
    if len(evidence.get("breakdown", {}).get("byStore", [])) < 2:
        return False
    text = "\n".join(
        v
        for v in [
            report.get("summary"),
            *report.get("findings", []),
            *report.get("cautions", []),
        ]
        if isinstance(v, str)
    )
    return bool(
        re.search(
            r"(점포별|매장별|지점별)[^.!?\n]{0,40}(데이터\s*(미제공|가?\s*없)|구분이?\s*없)",
            text,
        )
    )


async def custom_analysis(input, call=None):
    call = call or open_ai
    question = guard_question(input.get("question"))
    evidence = await forecast(input)
    if not os.getenv("OPENAI_API_KEY"):
        fail(
            "OpenAI API 키가 설정되지 않았습니다. 프로젝트 .env에 OPENAI_API_KEY를 입력하고 서버를 재시작하세요.",
            503,
        )
    if lock.locked():
        fail("분석이 진행 중입니다. 완료 후 다시 요청하세요.", 429)
    async with lock:
        now = time.monotonic()
        requests[:] = [t for t in requests if t >= now - 60]
        if len(requests) >= 6:
            fail("분당 6회까지 분석할 수 있습니다. 잠시 후 다시 시도하세요.", 429)
        requests.append(now)
        plan = await call(SCOPE_PROMPT, {"question": question}, PLAN_SCHEMA)
        if plan.get("allowed") is not True:
            fail(
                "DW 집계 분석과 이벤트 기획에 관한 질문만 허용됩니다. 질문을 다시 작성하세요."
            )
        report = await call(
            REPORT_PROMPT, dict(question=question, evidence=evidence), REPORT_SCHEMA
        )
        if contradicts(report, evidence):
            report = await call(
                REPORT_PROMPT + CORRECTION_PROMPT,
                dict(question=question, evidence=evidence),
                REPORT_SCHEMA,
            )
            if contradicts(report, evidence):
                fail(
                    "모델 설명이 DB의 점포별 집계와 일치하지 않습니다. 다시 분석하세요.",
                    502,
                )
        try:
            validate(report, REPORT_SCHEMA)
            if len(report["events"]) > 4 or any(
                e["campaignId"] is not None
                and e["campaignId"] not in [c["id"] for c in evidence["campaigns"]]
                for e in report["events"]
            ):
                raise ValueError()
        except (ValidationError, ValueError):
            fail("모델 응답 형식 검증에 실패했습니다. 다시 시도하세요.", 502)
        return dict(
            evidence=evidence, report=report, model=model(), generatedAt=stamp()
        )
