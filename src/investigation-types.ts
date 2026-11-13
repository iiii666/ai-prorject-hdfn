import type { Data, Spec, Config, Demonstration } from "./analysis-types";
export type Scope = {
  days: number;
  end: string;
  store: string;
  channel: string;
  comparison: string;
};
export type Step = {
  id: string;
  tool: string;
  dimension: string;
  reason: string;
  scope: Scope;
  at: string;
  result: Data & { tools?: Record<string, string> };
};
export type Proposal = {
  id: string;
  spec: Spec;
  config: Config;
  status: string;
  saved?: { appId: string; agentId: string };
};
export type Round = {
  id: string;
  prompt: string;
  scope: Scope;
  status: string;
  steps: Step[];
  error?: string;
  report?: { summary: string; evidenceIds: string[]; notes: string[] };
  proposal?: Proposal;
};
export type Session = {
  id: string;
  title: string;
  version: number;
  status: string;
  updated_at: string;
  state: {
    mode: "live" | "demo";
    task?: { agentId: string; runId: string; group: string; objective: string; demonstration?: Demonstration;
      filters: { gradeFilter?: string; categoryFilter?: string } };
    messages: { id: string; role: string; text: string; at: string }[];
    rounds: Round[];
  };
};
export type SessionList = Pick<
  Session,
  "id" | "title" | "version" | "status" | "updated_at"
>;
