import { useEffect, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  GitPullRequest,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Play,
} from "lucide-react";
import { useApi } from "./api";
import "./workflow.css";
type Task = {
  number: number;
  title: string;
  stage: string;
  url: string | null;
  updatedAt: string;
  branch: string | null;
  automated: boolean;
  pr: {
    number: number;
    url: string | null;
    draft: boolean;
    merged: boolean;
  } | null;
  report: {
    passed: boolean;
    checks: { name: string; status: string }[];
    runUrl: string | null;
  } | null;
  leadMinutes: number | null;
};
type Board = {
  repository: string;
  source: string;
  fetchedAt: string;
  cached: boolean;
  limited: boolean;
  counts: Record<string, number>;
  automationPRs: number;
  tasks: Task[];
};
const stages = [
  ["ready", "작업 대기"],
  ["running", "AI 작업 중"],
  ["review", "사람 리뷰"],
  ["blocked", "확인 필요"],
  ["done", "완료"],
];
const demo: Board = {
  repository: "iiii666/ai-prorject-hdfn",
  source: "demo",
  fetchedAt: "",
  cached: false,
  limited: false,
  automationPRs: 3,
  counts: { ready: 1, running: 1, review: 1, blocked: 1, done: 1 },
  tasks: stages.map(([stage], i) => ({
    number: 101 + i,
    title: [
      "점포별 매출 비중 표시",
      "빈 결과 안내 개선",
      "고객 등급 조회 필터",
      "실패한 회귀 테스트 수정",
      "캠페인 전환율 정합성 검증",
    ][i],
    stage,
    url: null,
    updatedAt: "",
    branch: i ? "agent/issue-demo" : null,
    automated: i > 0,
    pr:
      i >= 2
        ? {
            number: 201 + i,
            url: null,
            draft: stage === "blocked",
            merged: stage === "done",
          }
        : null,
    report:
      i >= 2
        ? {
            passed: stage !== "blocked",
            runUrl: null,
            checks: ["unit", "postgres", "build", "e2e"].map((name) => ({
              name,
              status:
                stage === "blocked" && name === "unit" ? "failed" : "passed",
            })),
          }
        : null,
    leadMinutes: i >= 2 ? 8 + i : null,
  })),
};
export default function DevelopmentWorkflow() {
  const [sample, setSample] = useState(false),
    [auto, setAuto] = useState(true),
    [revision, setRevision] = useState(0);
  const { data, loading, error } = useApi<Board>(
    sample ? null : "/api/development-workflow",
    revision,
  );
  const board = sample ? demo : data;
  useEffect(() => {
    if (!auto || sample) return;
    const timer = setInterval(() => setRevision((v) => v + 1), 60000);
    return () => clearInterval(timer);
  }, [auto, sample]);
  const repository = board?.repository || "iiii666/ai-prorject-hdfn";
  return (
    <div className="workflow-page">
      <div className={`workflow-source ${sample ? "demo" : ""}`}>
        <span>
          {sample
            ? "시연 데이터 · 실제 실행 기록이 아닙니다"
            : "GitHub 실제 조회 · 공개 Issue/PR 상태"}
        </span>
        <div>
          <button onClick={() => setSample((v) => !v)}>
            {sample ? "실제 데이터 보기" : "발표용 시연 보기"}
          </button>
          <button
            disabled={loading || sample}
            onClick={() => setRevision((v) => v + 1)}
            aria-label="작업 보드 새로고침"
          >
            <RefreshCw size={14} />
            새로고침
          </button>
        </div>
      </div>
      <div className="workflow-toolbar">
        <a
          href={`https://github.com/${repository}/issues/new/choose`}
          target="_blank"
          rel="noreferrer"
        >
          <Play size={14} />
          Issue 등록
        </a>
        <a
          href={`https://github.com/${repository}/actions/workflows/issue-to-pr.yml`}
          target="_blank"
          rel="noreferrer"
        >
          Actions 실행 <ExternalLink size={13} />
        </a>
        <a
          href={`https://github.com/${repository}/blob/main/docs/workflow/setup.md`}
          target="_blank"
          rel="noreferrer"
        >
          설치 및 시연 안내 <ExternalLink size={13} />
        </a>
        <label>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          60초 자동 조회
        </label>
      </div>
      <div className="workflow-flow">
        {[
          "Issue 등록",
          "설계 먼저 변경",
          "AI 구현·자체 테스트",
          "독립 CI 검증",
          "PR 생성",
          "사람 승인·병합",
        ].map((s, i) => (
          <span key={s}>
            <b>{i + 1}</b>
            {s}
            {i < 5 && <i>→</i>}
          </span>
        ))}
      </div>
      {error && !sample ? (
        <div className="workflow-error" role="alert">
          <AlertCircle size={18} />
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>다시 조회</button>
        </div>
      ) : loading && !sample ? (
        <div className="empty" role="status">
          GitHub 작업 상태를 조회하고 있습니다…
        </div>
      ) : (
        board && (
          <>
            <div className="workflow-stats">
              {stages.map(([key, label]) => (
                <article key={key}>
                  <span>{label}</span>
                  <strong>{board.counts[key] || 0}</strong>
                </article>
              ))}
            </div>
            <div className="workflow-board">
              {stages.map(([key, label]) => (
                <section
                  className={`workflow-column ${key}`}
                  key={key}
                  aria-label={label}
                >
                  <h2>
                    <span />
                    {label}
                    <small>{board.counts[key] || 0}</small>
                  </h2>
                  {board.tasks
                    .filter((t) => t.stage === key)
                    .map((task) => (
                      <article className="workflow-card" key={task.number}>
                        <div className="workflow-task-id">
                          Issue #{task.number}
                          <span>
                            {sample
                              ? "시연"
                              : task.automated
                                ? "AI PR"
                                : "일반 작업"}
                          </span>
                        </div>
                        <h3>
                          {task.url ? (
                            <a href={task.url} target="_blank" rel="noreferrer">
                              {task.title}
                            </a>
                          ) : (
                            task.title
                          )}
                        </h3>
                        {task.branch && (
                          <p className="workflow-branch">
                            <GitBranch size={12} />
                            {task.branch}
                          </p>
                        )}
                        {task.pr && (
                          <p>
                            <GitPullRequest size={13} />
                            {task.pr.url ? (
                              <a
                                href={task.pr.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                PR #{task.pr.number}
                              </a>
                            ) : (
                              `시연 PR #${task.pr.number}`
                            )}
                            <span>
                              {task.pr.merged
                                ? "병합됨"
                                : task.pr.draft
                                  ? "Draft"
                                  : "리뷰 대기"}
                            </span>
                          </p>
                        )}
                        {task.report && (
                          <>
                            <div className="workflow-checks">
                              {task.report.checks.map((c) => (
                                <span className={c.status} key={c.name}>
                                  {c.status === "passed" ? (
                                    <CheckCircle2 size={11} />
                                  ) : (
                                    <AlertCircle size={11} />
                                  )}
                                  {c.name}
                                </span>
                              ))}
                            </div>
                            <small className="workflow-report-label">
                              PR에 기록된 독립 검증 결과
                            </small>
                            {task.report.runUrl && (
                              <a
                                className="workflow-run-link"
                                href={task.report.runUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                실행 로그·테스트 아티팩트 →
                              </a>
                            )}
                          </>
                        )}
                        {task.leadMinutes !== null && (
                          <small>
                            Issue 등록 → PR 생성 {task.leadMinutes}분 (대기
                            포함)
                          </small>
                        )}
                        {!task.pr && key === "ready" && (
                          <p className="workflow-help">
                            수용 조건 작성 후 팀원이 ai-ready를 붙이면 자동
                            실행됩니다.
                          </p>
                        )}
                        {key === "running" && !task.pr && (
                          <p className="workflow-help">
                            Issue 댓글과 Actions에서 현재 실행을 확인하세요.
                          </p>
                        )}
                      </article>
                    ))}
                  {!board.tasks.some((t) => t.stage === key) && (
                    <p className="workflow-empty">작업 없음</p>
                  )}
                </section>
              ))}
            </div>
            <p className="workflow-footnote">
              {sample
                ? "위 카드는 발표 설명용 고정 예시이며 실제 자동화 성과에 포함하지 않습니다."
                : `조회 ${new Date(board.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} KST · 서버 60초 캐시 · 자동 생성 PR ${board.automationPRs}개`}
              {board.limited &&
                " · 최근 100개 제한: 전체 이력은 GitHub에서 확인하세요."}
            </p>
          </>
        )
      )}
      <div className="workflow-notes">
        <h2>발표 때 보여줄 순서</h2>
        <ol>
          <li>GitHub Issue의 문제·수용 조건·설계·테스트 계획을 확인합니다.</li>
          <li>ai-ready → Actions 실행과 설계 선행 커밋을 보여줍니다.</li>
          <li>PR의 실제 Unit·PostgreSQL·E2E·Build 로그를 확인합니다.</li>
          <li>
            팀원이 리뷰하고 main에 병합한 뒤 DW 화면에서 변경 결과를 확인합니다.
          </li>
        </ol>
        <p>
          이 화면은 조회 전용입니다. 아직 실행하지 않은 에이전트 작업을
          성공했다고 표시하지 않습니다. main 보호 규칙과 Actions Secret/권한
          설정은 설치 안내를 따르세요.
        </p>
      </div>
    </div>
  );
}
