import math
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal


class AnalysisError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def fail(message, status=400):
    raise AnalysisError(message, status)


def date_add(value, days):
    return (date.fromisoformat(value) + timedelta(days=days)).isoformat()


def stamp():
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def js_round(value):
    floor = math.floor(value)
    return floor + int(value - floor >= 0.5)


def fixed(value):
    return float(
        Decimal.from_float(float(value)).quantize(
            Decimal(".01"), rounding=ROUND_HALF_UP
        )
    )


def percent(a, b):
    return js_round(a / b * 10000) / 100 if b else None


def ratio(a, b):
    return fixed(a / b * 100) if b else None


def change(a, b):
    return fixed((a - b) / b * 100) if b else None


def number(value):
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return float("nan")
