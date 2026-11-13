import { readFile } from "node:fs/promises";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { bad, METRICS } from "./app-plans.mjs";
import { workflowView, reviewContext, recordReportExport } from "./task-workflow.mjs";
const judgments = { unreviewed: "미판단", expected: "예상된 변화", important: "중요하게 확인", resolved: "업무상 해결로 판단" };
const decisions = { investigate: "추가 조사 계속", follow_up: "다음 실행에서 회복 여부 확인", contact: "담당자에게 확인할 내용 정리" };
export async function taskReport(agentId, input) {
  const context = await reviewContext(agentId, input);
  const view = await workflowView(agentId, input);
  const { review, session } = view;
  const round = session?.state.rounds.at(-1);
  const config = context.run.report.config || context.agent.config;
  const allEvidence = session?.state.rounds.flatMap((r) => r.steps) || [];
  const citedIds = new Set(round?.report?.evidenceIds || []);
  const report = {
    title: `${context.agent.name} 보고서`, group: context.group,
    objective: context.agent.config.objective || "", generatedAt: new Date().toISOString(),
    runId: context.run.id, runAt: context.run.created_at, range: context.run.report.range,
    metric: config.metric, metricLabel: METRICS[config.metric].label, unit: METRICS[config.metric].unit,
    summary: context.run.report.summary, rows: context.row ? [context.row] : context.run.report.rows,
    history: context.history, businessContext: review.state.context?.note || "특이사항 미입력",
    judgment: judgments[review.state.judgment], judgmentNote: review.state.judgmentNote,
    decision: review.state.decision ? decisions[review.state.decision.kind] : "다음 행동 미선택",
    decisionNote: review.state.decision?.note || "",
    analysis: round?.report?.summary || "추가 조사를 완료한 뒤 보고서를 생성하세요.",
    question: round?.report?.followUpQuestion || "",
    mode: session?.state.mode || input.mode,
    evidence: allEvidence.filter((step, index) => citedIds.has(step.id) || index >= allEvidence.length - 18),
    conversation: session?.state.messages.slice(-12) || [],
    reviewVersion: review.version, sessionVersion: session?.version || null,
    ready: !!(review.state.acknowledged && review.state.context && review.state.decision &&
      round?.status === "completed" && round.report?.evidenceIds?.length &&
      session.state.task?.businessContext?.note === review.state.context.note),
    // Source metadata remains attached to the exported snapshot, not substituted for DW records.
    source: context.run.report.demonstration ? "prepared-workspace-data" : "warehouse-aggregates",
    notes: ["조회 수치는 실행 시점의 집계입니다.", "사용자 제공 상황과 업무 판단은 확인된 원인 또는 실적 회복과 구분합니다.",
      "AI 해석은 가설이며 인과관계를 입증하지 않습니다."],
  };
  return report;
}
const num = (v, unit = "") => v == null ? "—" : `${Number(v).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
let fontBytes;
export async function renderTaskPdf(report) {
  fontBytes ||= readFile(new URL("../assets/fonts/NanumGothic-Regular.ttf", import.meta.url));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fontBytes, { subset: true });
  doc.setTitle(report.title); doc.setAuthor("DW 업무 분석");
  doc.setSubject(`${report.group} / ${report.range.start} ~ ${report.range.end}`);
  doc.setKeywords([report.source, report.runId]);
  const supported = new Set(font.getCharacterSet());
  const clean = (s) => [...String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ")]
    .filter((c) => c === "\n" || supported.has(c.codePointAt(0))).join("");
  let page, y;
  const blue = rgb(.16, .28, .46), ink = rgb(.20, .25, .33), muted = rgb(.45, .50, .57);
  function addPage() {
    page = doc.addPage([595.28, 841.89]); y = 785;
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
    page.drawText("DW WORKSPACE / BUSINESS REVIEW", { x: 42, y: 812, font, size: 8, color: muted });
    page.drawLine({ start: { x: 42, y: 802 }, end: { x: 553, y: 802 }, color: rgb(.85, .89, .94) });
  }
  function line(value, size = 10, color = ink, gap = 5) {
    const content = clean(value);
    for (const paragraph of content.split("\n")) {
      let current = "";
      const lines = [];
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(current + char, size) > 505 && current) { lines.push(current); current = char; }
        else current += char;
      }
      lines.push(current);
      for (const l of lines) {
        if (y < 66) addPage();
        page.drawText(l, { x: 44, y, size, font, color }); y -= size * 1.6;
      }
    }
    y -= gap;
  }
  function heading(label) { if (y < 110) addPage(); y -= 12; line(label, 13, blue, 8); }
  addPage(); line(report.title, 20, blue, 8); line(report.group, 12, muted);
  line(`분석 기간  ${report.range.start} ~ ${report.range.end}`);
  line(`비교 기간  ${report.range.previousStart} ~ ${report.range.previousEnd}`);
  line(`생성 시각  ${new Date(report.generatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간)`, 9, muted);
  heading("1. 상황 보고"); line(report.objective); line(report.summary);
  for (const row of report.rows || []) {
    const metric = row.metrics[report.metric];
    line(`${row.label}  |  현재 ${num(metric?.value, report.unit)}  |  비교 ${num(metric?.previous, report.unit)}  |  증감 ${num(metric?.change, "%")}`);
  }
  heading("2. 사용자가 알려준 업무 상황"); line(report.businessContext);
  line(`사용자 판단: ${report.judgment}${report.judgmentNote ? " / " + report.judgmentNote : ""}`);
  heading("3. 추가 조사와 해석"); line(report.mode === "live" ? "AI 해석 · 확인이 필요한 가설" : "규칙 기반 해석", 9, muted);
  line(report.analysis); if (report.question) line(`추가 확인: ${report.question}`);
  heading("4. 다음 행동"); line(report.decision); if (report.decisionNote) line(report.decisionNote);
  if (report.decision.includes("담당자")) {
    line("담당자 확인 질문");
    line("- 비교 기간에 행사·상품 구성·운영 시간의 변화가 있었나요?\n- 감소가 확인된 채널이나 고객군에서 별도 이슈가 있었나요?\n- 다음 확인 시점까지 실행할 조치와 담당자는 누구인가요?");
  }
  heading("5. 이전 실행 비교");
  if (!report.history.length) line("비교할 이전 실행이 없습니다.");
  for (const history of report.history) {
    line(`${history.range.start} ~ ${history.range.end}  |  ${history.summary || "이전 실행"}`);
    for (const row of history.rows || []) {
      const m = row.metrics[report.metric]; if (m) line(`${row.label}: ${num(m.value, report.unit)} / 비교 대비 ${num(m.change, "%")}`, 9, muted);
    }
  }
  heading("6. 조회 근거");
  for (const [index, step] of report.evidence.entries()) {
    line(`근거 ${index + 1}: ${step.reason || step.tool}`, 10, blue);
    line(`기간 ${step.scope.end}까지 ${step.scope.days}일 / ${step.scope.channel || "전체 채널"} / ID ${step.id}`, 8, muted);
    for (const row of step.result.rows || []) {
      const entries = Object.entries(row.metrics).map(([key, metric]) => `${METRICS[key]?.label || key} ${num(metric.value, METRICS[key]?.unit || "")} (비교 ${num(metric.previous)}, 증감 ${num(metric.change, "%")})`);
      line(`${row.label}  |  ${entries.join(" / ")}`, 9);
    }
    if (step.result.history) line("이 근거는 위의 이전 실행 비교에 연결된 저장 이력입니다.", 9, muted);
  }
  heading("7. 주요 대화 기록");
  for (const m of report.conversation) line(`${m.role === "user" ? "사용자" : "에이전트"}: ${m.text}`, 9);
  heading("해석 안내"); for (const note of report.notes) line(note, 9, muted);
  for (const [index, p] of doc.getPages().entries()) p.drawText(`${index + 1} / ${doc.getPageCount()}`, { x: 510, y: 32, size: 9, font, color: muted });
  return doc.save();
}
export async function exportTaskPdf(agentId, input) {
  const report = await taskReport(agentId, input);
  if (!report.ready) bad("상황 확인, 업무 상황 저장, 추가 조사 완료와 다음 행동 선택을 마친 뒤 PDF를 저장하세요.");
  if (report.reviewVersion !== input.version || report.sessionVersion !== input.sessionVersion)
    bad("보고서 내용이 바뀌었습니다. 미리보기를 다시 확인하세요.", 409);
  const bytes = await renderTaskPdf(report);
  const current = await workflowView(agentId, input);
  if (current.session?.version !== report.sessionVersion)
    bad("PDF 생성 중 대화가 바뀌었습니다. 미리보기를 다시 확인하세요.", 409);
  const filename = `task-report-${report.runId.slice(0, 8)}.pdf`;
  await recordReportExport(agentId, input, { at: report.generatedAt, filename, sessionVersion: report.sessionVersion });
  return { download: { bytes, filename, contentType: "application/pdf" } };
}
