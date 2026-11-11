import { all, one, dateAdd } from "./db.mjs";
import { METRICS, validateSpec, validateStore } from "./app-plans.mjs";
const round = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
export function previousYear(day) {
  const year = Number(day.slice(0, 4)) - 1,
    month = Number(day.slice(5, 7)),
    date = Number(day.slice(8, 10));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(date, last)).padStart(2, "0")}`;
}
export function ranges(spec, end) {
  const start = dateAdd(end, 1 - spec.days);
  return {
    start,
    end,
    previousStart:
      spec.comparison === "year"
        ? previousYear(start)
        : dateAdd(start, -spec.days),
    previousEnd:
      spec.comparison === "year" ? previousYear(end) : dateAdd(start, -1),
  };
}
async function grouped(spec, start, end, categoryFilter, gradeFilter) {
  const args = [
    start,
    end,
    ...(spec.store ? [Number(spec.store)] : []),
    ...(spec.channel ? [spec.channel] : []),
    ...(categoryFilter ? [categoryFilter] : []),
    ...(gradeFilter ? [gradeFilter] : []),
  ];
  const scope = (alias) =>
    `${spec.store ? ` AND ${alias}.store_id=?` : ""}${spec.channel ? ` AND ${alias}.channel=?` : ""}`;
  const group = (alias, date, category = false) => {
    if (category) return ["p.category", "p.category"];
    if (spec.dimension === "grade") return ["c.grade", "c.grade"];
    return spec.dimension === "store"
      ? [`CAST(${alias}.store_id AS TEXT)`, "s.name"]
      : spec.dimension === "channel"
        ? [`${alias}.channel`, `${alias}.channel`]
        : [`${alias}.${date}`, `${alias}.${date}`];
  };
  const rows = new Map();
  function merge(list, metric, field) {
    for (const r of list) {
      const id = String(r.id);
      if (!rows.has(id)) rows.set(id, { id, label: r.label, values: {} });
      rows.get(id).values[metric] = round(r[field]);
    }
  }
  const [key, label] = group("o", "ordered_at", spec.dimension === "category");
  const category = spec.dimension === "category" || !!categoryFilter;
  const sales = await all(
    `SELECT ${key} id,${label} label,COALESCE(SUM(${category ? "i.quantity*i.unit_price" : "o.amount"}),0) sales,COUNT(DISTINCT o.id) orders,COUNT(DISTINCT o.customer_id) activeCustomers FROM dw_fact_orders o JOIN stores s ON s.id=o.store_id ${spec.dimension === "grade" || gradeFilter ? "JOIN customers c ON c.id=o.customer_id" : ""} ${category ? "JOIN order_items i ON i.order_id=o.id JOIN products p ON p.id=i.product_id" : ""} WHERE o.ordered_at BETWEEN ? AND ?${scope("o")}${categoryFilter ? " AND p.category=?" : ""}${gradeFilter ? " AND c.grade=?" : ""} GROUP BY ${key},${label} ORDER BY ${key}`,
    args,
  );
  for (const r of sales) r.averageOrder = r.orders ? r.sales / r.orders : null;
  for (const metric of spec.metrics.filter((m) =>
    ["sales", "orders", "averageOrder", "activeCustomers"].includes(m),
  ))
    merge(sales, metric, metric);
  if (spec.metrics.includes("appConversion")) {
    const [k, l] = group("a", "session_date");
    merge(
      await all(
        `SELECT ${k} id,${l} label,100.0*COUNT(a.order_id)/NULLIF(COUNT(*),0) value FROM app_sessions a JOIN stores s ON s.id=a.store_id WHERE a.session_date BETWEEN ? AND ?${scope("a")} GROUP BY ${k},${l}`,
        args,
      ),
      "appConversion",
      "value",
    );
  }
  if (
    spec.metrics.some((m) => ["budgetExecution", "achievement"].includes(m))
  ) {
    const [k, l] = group("b", "date");
    const b = await all(
      `SELECT ${k} id,${l} label,SUM(b.planned) planned,SUM(b.spent) spent,SUM(b.sales_target) target FROM budget_daily b JOIN stores s ON s.id=b.store_id WHERE b.date BETWEEN ? AND ?${scope("b")} GROUP BY ${k},${l}`,
      args,
    );
    for (const r of b) {
      r.budgetExecution = r.planned ? (100 * r.spent) / r.planned : null;
      r.achievement = r.target
        ? (100 *
            (sales.find((s) => String(s.id) === String(r.id))?.sales || 0)) /
          r.target
        : null;
    }
    for (const m of spec.metrics.filter((m) =>
      ["budgetExecution", "achievement"].includes(m),
    ))
      merge(b, m, m);
  }
  return [...rows.values()];
}
export async function appData(
  raw,
  { end, strictCoverage = false, categoryFilter, gradeFilter } = {},
) {
  const spec = await validateStore(validateSpec(raw));
  const seed = await one("SELECT * FROM seed_info");
  const range = ranges(spec, end || spec.end || seed.end_date);
  const operational =
    (await one("SELECT value FROM settings WHERE key='operationalStart'"))
      ?.value || seed.start_date;
  const coverageStart = spec.metrics.some((m) =>
    ["appConversion", "budgetExecution", "achievement"].includes(m),
  )
    ? operational > seed.start_date
      ? operational
      : seed.start_date
    : seed.start_date;
  const complete =
    range.start >= coverageStart &&
    range.end <= seed.end_date &&
    range.previousStart >= coverageStart &&
    range.previousEnd <= seed.end_date;
  if (strictCoverage && !complete)
    return {
      spec,
      range,
      rows: [],
      complete: false,
      coverageStart,
      coverageEnd: seed.end_date,
      notes: [
        "비교 기간까지 데이터가 완전히 보유되지 않아 판단을 보류했습니다.",
      ],
    };
  const [current, previous] = await Promise.all([
    grouped(spec, range.start, range.end, categoryFilter, gradeFilter),
    grouped(
      spec,
      range.previousStart,
      range.previousEnd,
      categoryFilter,
      gradeFilter,
    ),
  ]);
  const ids = new Set([
    ...current.map((r) => r.id),
    ...previous.map((r) => r.id),
  ]);
  const rows = [...ids].sort().map((id) => {
    const a = current.find((r) => r.id === id),
      b = previous.find((r) => r.id === id);
    return {
      id,
      label: a?.label || b?.label,
      metrics: Object.fromEntries(
        spec.metrics.map((m) => {
          const missing = ["sales", "orders", "activeCustomers"].includes(m)
            ? 0
            : null;
          const value = a?.values[m] ?? missing,
            prior = b?.values[m] ?? missing;
          return [
            m,
            {
              value,
              previous: prior,
              change:
                prior === null || prior === 0 || value === null
                  ? null
                  : round((100 * (value - prior)) / prior),
              difference:
                value === null || prior === null ? null : round(value - prior),
            },
          ];
        }),
      ),
    };
  });
  // 일별 전년/전기 비교는 위치별 일자로 정렬해 매핑한다.
  if (spec.dimension === "day") {
    rows.length = 0;
    for (let i = 0; i < spec.days; i++) {
      const day = dateAdd(range.start, i),
        prior =
          spec.comparison === "year"
            ? previousYear(day)
            : dateAdd(range.previousStart, i);
      const a = current.find((r) => r.id === day),
        b = previous.find((r) => r.id === prior);
      rows.push({
        id: day,
        label: day,
        metrics: Object.fromEntries(
          spec.metrics.map((m) => {
            const fallback = ["sales", "orders", "activeCustomers"].includes(m)
              ? 0
              : null;
            const value = a?.values[m] ?? fallback,
              p = b?.values[m] ?? fallback;
            return [
              m,
              {
                value,
                previous: p,
                change:
                  p === null || p === 0 || value === null
                    ? null
                    : round((100 * (value - p)) / p),
                difference:
                  value === null || p === null ? null : round(value - p),
              },
            ];
          }),
        ),
      });
    }
  }
  return {
    spec,
    range,
    rows,
    complete,
    coverageStart,
    coverageEnd: seed.end_date,
    queriedAt: new Date().toISOString(),
    definitions: spec.metrics.map((m) => ({ id: m, ...METRICS[m] })),
    notes: [
      ...(!complete
        ? [
            "데이터 보유 범위를 벗어난 기간이 포함됩니다. 미보유 기간을 실적 0으로 해석하지 마세요.",
          ]
        : []),
      "비율 지표의 변화율은 상대 증감률(%)이며, 차이는 퍼센트포인트입니다.",
      "활성 고객 수는 그룹 간 합산하면 중복될 수 있습니다.",
      "모든 수치는 생성 샘플 DB 집계이며 원인·인과 효과를 입증하지 않습니다.",
    ],
  };
}
