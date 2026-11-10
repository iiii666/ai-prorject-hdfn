import { useState } from "react";
import { Sparkles, ShieldCheck } from "lucide-react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { request, useApi } from "./api";
import type { Bootstrap } from "./api";
import {
  Panel,
  Kpi,
  DataTable,
  money,
  compactMoney,
  timestamp,
} from "./components";
type Status = {
  configured: boolean;
  model: string;
  years: number[];
  seed: { start_date: string; end_date: string };
  operationalStart: string;
};
type Result = {
  model: string;
  generatedAt: string;
  report: {
    summary: string;
    findings: string[];
    events: {
      title: string;
      month: number;
      audience: string;
      reason: string;
      campaignId: number | null;
    }[];
    cautions: string[];
  };
  evidence: {
    year: number;
    targetYear: number;
    uplift: number;
    growth: number;
    actualTotal: number;
    baselineTotal: number;
    eventTotal: number;
    coverageStart: string;
    coverageEnd: string;
    limitations: string[];
    monthly: {
      month: string;
      actualMonth: string;
      actual: number | null;
      coveredDays: number;
      totalDays: number;
      baseline: number;
      conservative: number;
      optimistic: number;
      withEvent: number;
      source: string;
    }[];
    campaigns: {
      id: number;
      name: string;
      target: number;
      converted: number;
    }[];
  };
};
export default function CustomAnalysis({
  bootstrap,
}: {
  bootstrap: Bootstrap;
}) {
  const state = useApi<Status>("/api/custom/status");
  const [year, setYear] = useState(""),
    [store, setStore] = useState(""),
    [channel, setChannel] = useState(""),
    [uplift, setUplift] = useState(5),
    [question, setQuestion] = useState(
      "2026년 매출을 분석해서 내년에 어떤 이벤트를 하면 좋을지 추천하고 예상 매출을 보여줘.",
    ),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result | null>(null);
  const status = state.data;
  return (
    <div className="custom-analysis">
      <div className="definition-note">
        <ShieldCheck size={16} /> DW 집계 분석 전용 · 개인정보/원본 명단/DB
        변경/무관한 질문은 차단합니다. 집계 데이터와 질문이 OpenAI에 전송됩니다.
      </div>
      {state.loading ? (
        <div className="empty">분석 설정을 확인하고 있습니다…</div>
      ) : state.error ? (
        <div className="empty" role="alert">
          {state.error}
        </div>
      ) : (
        status && (
          <>
            <Panel
              title="무엇을 분석할까요?"
              aside={<span className="muted">{status.model}</span>}
            >
              <form
                className="custom-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  setError("");
                  setResult(null);
                  try {
                    setResult(
                      await request<Result>("/api/custom/analyze", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          question,
                          year: Number(year || status.years[0]),
                          store,
                          channel,
                          uplift,
                        }),
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <fieldset className="custom-controls" disabled={loading}>
                  <div className="query-filters">
                    <label>
                      기준 연도
                      <select
                        aria-label="분석 기준 연도"
                        value={year || status.years[0]}
                        onChange={(e) => {
                          setYear(e.target.value);
                          setResult(null);
                        }}
                      >
                        {status.years.map((y) => (
                          <option key={y}>{y}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      점포
                      <select
                        aria-label="분석 점포"
                        value={store}
                        onChange={(e) => {
                          setStore(e.target.value);
                          setResult(null);
                        }}
                      >
                        <option value="">전체 점포</option>
                        {bootstrap.stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      채널
                      <select
                        aria-label="분석 채널"
                        value={channel}
                        onChange={(e) => {
                          setChannel(e.target.value);
                          setResult(null);
                        }}
                      >
                        <option value="">전체 채널</option>
                        {bootstrap.channels.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      이벤트 매출 증가 가정 (%)
                      <input
                        aria-label="이벤트 효과 가정"
                        type="number"
                        min="0"
                        max="20"
                        step="0.5"
                        value={uplift}
                        onChange={(e) => {
                          setUplift(Number(e.target.value));
                          setResult(null);
                        }}
                      />
                    </label>
                  </div>
                  <p className="muted">
                    선택한 기준 연도·점포·채널을 우선 적용하며, 다음 연도를
                    예측합니다. 질문의 연도와 선택 조건을 맞춰주세요.
                  </p>
                  <label className="question-label">
                    분석 질문
                    <textarea
                      required
                      minLength={5}
                      maxLength={1000}
                      value={question}
                      onChange={(e) => {
                        setQuestion(e.target.value);
                        setResult(null);
                      }}
                      placeholder="점포 매출과 캠페인 성과를 토대로 내년 이벤트를 추천해 줘."
                    />
                  </label>
                </fieldset>
                <div className="question-actions">
                  <span className="muted">
                    {question.length}/1,000자 · 분석에 최대 약 90초가 걸릴 수
                    있습니다.
                  </span>
                  <button className="primary" disabled={loading}>
                    <Sparkles size={15} />
                    {loading ? "질문 검증 및 분석 중…" : "LLM 분석 실행"}
                  </button>
                </div>
                {!status.configured && (
                  <div className="definition-note">
                    OpenAI API 키 설정이 필요합니다. 프로젝트의{" "}
                    <code>.env.example</code>을 <code>.env</code>로 복사하고{" "}
                    <code>OPENAI_API_KEY</code>를 입력한 뒤 서버를 재시작하세요.
                    키를 화면이나 GitHub에 입력하지 마세요.
                  </div>
                )}
                {error && (
                  <div className="analysis-error" role="alert">
                    {error}
                  </div>
                )}
                {loading && (
                  <p role="status" className="muted">
                    질문 범위를 검사하고 DB 집계와 서버 예측을 바탕으로 보고서를
                    작성하고 있습니다…
                  </p>
                )}
              </form>
            </Panel>
            {result && (
              <>
                <div className="result-heading">
                  <h2>
                    분석 결과 · {result.evidence.year} →{" "}
                    {result.evidence.targetYear}
                  </h2>
                  <span className="muted">
                    {result.model} · {timestamp(result.generatedAt)}
                  </span>
                </div>
                <div className="kpi-grid">
                  <Kpi
                    label="기준 연도 보유 실적"
                    value={compactMoney(result.evidence.actualTotal)}
                    note="불완전한 연도일 수 있습니다"
                  />
                  <Kpi
                    label="다음 연도 기준 예측"
                    value={compactMoney(result.evidence.baselineTotal)}
                    note={`적용 성장률 ${result.evidence.growth}%`}
                  />
                  <Kpi
                    label="이벤트 시나리오"
                    value={compactMoney(result.evidence.eventTotal)}
                    note={`매출 증가 ${result.evidence.uplift}% 가정`}
                  />
                  <Kpi
                    label="이벤트 가정 증가액"
                    value={compactMoney(
                      result.evidence.eventTotal -
                        result.evidence.baselineTotal,
                    )}
                    note="인과 효과 추정이 아닌 가정"
                  />
                </div>
                <Panel
                  title="다음 연도 월별 매출 시나리오"
                  aside={
                    <span className="muted">
                      서버 계산 · 보수/낙관은 ±15% 가정
                    </span>
                  }
                >
                  <div className="forecast-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={result.evidence.monthly}
                        margin={{ left: 10, right: 15, top: 15, bottom: 5 }}
                      >
                        <CartesianGrid vertical={false} stroke="#edf0f6" />
                        <XAxis
                          dataKey="month"
                          tickFormatter={(v) => v.slice(5) + "월"}
                        />
                        <YAxis
                          width={65}
                          tickFormatter={(v) => (v / 1e8).toFixed(1) + "억"}
                        />
                        <Tooltip formatter={(v) => money(Number(v))} />
                        <Legend />
                        <Line
                          dataKey="actual"
                          name="전년 보유 실적 (월 대응)"
                          stroke="#9aa9c0"
                          strokeDasharray="3 3"
                          connectNulls={false}
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="baseline"
                          name="기준 예측"
                          stroke="#4f80ff"
                          dot={false}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="conservative"
                          name="보수 가정"
                          stroke="#b9c8eb"
                          strokeDasharray="4 4"
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="optimistic"
                          name="낙관 가정"
                          stroke="#ab96e7"
                          strokeDasharray="4 4"
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="withEvent"
                          name="이벤트 가정"
                          stroke="#25b69a"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="definition-note">
                    전년 실적 선은 기준 연도의 같은 월을 대응해 표시합니다. 부분
                    월은 월 전체 매출이 아니며, 미래·미보유 월은 선을 표시하지
                    않습니다.
                  </p>
                </Panel>
                <Panel title="LLM 분석 보고서">
                  <div className="report-body">
                    <p>{result.report.summary}</p>
                    <h3>관찰한 내용</h3>
                    <ul>
                      {result.report.findings.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                    <h3>추천 이벤트</h3>
                    <div className="event-grid">
                      {result.report.events.map((e, i) => (
                        <article key={i}>
                          <span className="purple-tag">{e.month}월 제안</span>
                          <h3>{e.title}</h3>
                          <p>대상: {e.audience}</p>
                          <p>{e.reason}</p>
                          <small>
                            근거:{" "}
                            {e.campaignId === null
                              ? "검증 전 기획 가설"
                              : result.evidence.campaigns.find(
                                  (c) => c.id === e.campaignId,
                                )?.name}
                          </small>
                        </article>
                      ))}
                    </div>
                    <h3>모델이 제시한 주의사항</h3>
                    <ul>
                      {result.report.cautions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </Panel>
                <Panel title="계산 근거 및 가정">
                  <div className="report-body">
                    <p>
                      DB 매출 보유 기간: {result.evidence.coverageStart} ~{" "}
                      {result.evidence.coverageEnd}
                    </p>
                    <ul>
                      {result.evidence.limitations.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <DataTable
                    headers={[
                      "대응 월",
                      "기준 연도 실적",
                      "보유 일수",
                      "예측 기준",
                      "기준 예측",
                      "이벤트 가정",
                    ]}
                    rows={result.evidence.monthly.map((m) => [
                      m.actualMonth,
                      m.actual === null ? "미보유" : money(m.actual),
                      `${m.coveredDays}/${m.totalDays}일`,
                      m.source,
                      money(m.baseline),
                      money(m.withEvent),
                    ])}
                  />
                </Panel>
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
