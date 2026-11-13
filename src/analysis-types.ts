export type Spec = {
  title: string;
  end?: string;
  metrics: string[];
  dimension: string;
  days: number;
  comparison: string;
  store: string;
  channel: string;
  chart: string;
};
export type SavedApp = {
  id: string;
  title: string;
  spec: Spec;
  version: number;
  updated_at: string;
};
export type Meta = {
  metrics: Record<
    string,
    { label: string; unit: string; definition: string; source: string }
  >;
  dimensions: Record<string, string>;
  aiConfigured: boolean;
};
export type Metric = {
  value: number | null;
  previous: number | null;
  change: number | null;
  difference: number | null;
};
export type Data = {
  demonstration?: Demonstration;
  spec: Spec;
  range: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
  };
  rows: { id: string; label: string; metrics: Record<string, Metric> }[];
  complete: boolean;
  notes: string[];
  queriedAt: string;
};
export type Demonstration = { id: string; anchorEnd: string; phase: number; description: string };
export type Config = {
  name: string;
  frequency: string;
  weekday: number;
  time: string;
  metric: string;
  condition: string;
  threshold: number;
  period: string;
  investigationMode?: "off" | "demo" | "live";
  objective?: string;
  demoScenario?: { id: string; anchorEnd: string };
};
export type Agent = {
  id: string;
  app_id: string;
  name: string;
  config: Config;
  enabled: boolean;
  next_run: string;
  latestRun?: { status: string; created_at: string; summary?: string; findings: { state: string }[] };
};
export type Finding = {
  key: string;
  group: string;
  state: "new" | "ongoing" | "recovered" | "deferred";
  firstSeen: string;
  lastSeen: string;
  metric: Metric | null;
  previousMetric: Metric | null;
  previousRunId: string | null;
  investigation?: {
    mode: "off" | "demo" | "live";
    status: string;
    sessionId?: string;
    summary?: string;
    queryCount?: number;
  };
};
export type Run = {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  finished_at: string;
  report: {
    demonstration?: Demonstration;
    replay?: { asOf: string; source: string; description: string };
    summary?: string;
    appTitle?: string;
    appVersion?: number;
    config?: Config;
    range?: Data["range"];
    rows?: (Data["rows"][number] & { matched: boolean | null })[];
    investigations?: {
      group: string;
      details: {
        dimension: string;
        rows: {
          label: string;
          value: number;
          previous: number;
          difference: number;
        }[];
      }[];
    }[];
    steps?: string[];
    notes?: string[];
    taskMode?: "off" | "demo" | "live";
    findings?: Finding[];
  };
};
