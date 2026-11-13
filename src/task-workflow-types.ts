import type { Data, Run } from "./analysis-types";
import type { Session, Step } from "./investigation-types";
export type ReviewState = {
  acknowledged: boolean;
  context: { note: string; at: string } | null;
  judgment: string;
  judgmentNote: string;
  decision: { kind: string; note: string; at: string } | null;
  threads: Record<string, string>;
  lastExport?: { at: string; filename: string };
};
export type WorkflowView = {
  review: { id: string; version: number; state: ReviewState; updated_at: string | null };
  session: Session | null;
  group: string;
  history: { runId: string; range: Data["range"]; summary: string; rows: Data["rows"]; findings: Run["report"]["findings"] }[];
  memory: { runId: string; context: ReviewState["context"]; judgment: string; judgmentNote: string; decision: ReviewState["decision"]; at: string }[];
};
export type TaskReport = {
  title: string; group: string; objective: string; generatedAt: string; range: Data["range"];
  metric: string; metricLabel: string; unit: string; summary: string; rows: Data["rows"];
  history: WorkflowView["history"]; businessContext: string; judgment: string; judgmentNote: string;
  decision: string; decisionNote: string; analysis: string; question: string; mode: string;
  evidence: Step[]; reviewVersion: number; sessionVersion: number; ready: boolean;
};
