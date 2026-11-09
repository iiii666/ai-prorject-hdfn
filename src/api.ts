import { useEffect, useState } from "react";
export type Settings = { workspaceName: string; alertsEnabled: boolean };
export type Seed = {
  start_date: string;
  end_date: string;
  created_at: string;
  version: number;
};
export type Bootstrap = {
  stores: { id: number; name: string }[];
  channels: string[];
  seed: Seed;
  settings: Settings;
};
export type Campaign = {
  id: number;
  name: string;
  channel: string;
  start_date: string;
  end_date: string;
  target: number;
  converted: number;
  planned: number;
  spent: number;
  revenue: number;
  conversion: number | null;
  progress: number | null;
  status: string;
};
export type Analytics = {
  range: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
    days: number;
    store: string;
    channel: string;
  };
  seed: Seed;
  queriedAt: string;
  summary: {
    sales: number;
    orders: number;
    activeCustomers: number;
    averageOrder: number;
    salesChange: number | null;
    customerChange: number | null;
    orderChange: number | null;
    averageChange: number | null;
  };
  customers: {
    total: number;
    active: number;
    new: number;
    repeat: number;
    repurchaseRate: number | null;
    dormant: number;
    totalChange: number | null;
    newChange: number | null;
    repurchaseChange: number | null;
    grades: { grade: string; count: number; share: number | null }[];
    segments: {
      name: string;
      count: number;
      sales: number;
      share: number | null;
      averageOrder: number;
    }[];
  };
  sales: {
    trend: { date: string; sales: number; previous: number; orders: number }[];
    categories: {
      category: string;
      sales: number;
      quantity: number;
      share: number | null;
    }[];
    byStore: { name: string; sales: number; orders: number }[];
  };
  campaigns: {
    items: Campaign[];
    target: number;
    converted: number;
    spent: number;
    planned: number;
    revenue: number;
    conversion: number | null;
    conversionChange: number | null;
  };
  app: {
    sessions: number;
    users: number;
    viewed: number;
    cart: number;
    purchased: number;
    duration: number;
    conversion: number | null;
    dailyAverage: number;
    userChange: number | null;
    conversionChange: number | null;
    daily: { date: string; users: number; sessions: number }[];
  };
  budget: {
    planned: number;
    spent: number;
    salesTarget: number;
    remaining: number;
    execution: number | null;
    achievement: number | null;
    departments: {
      department: string;
      planned: number;
      spent: number;
      salesTarget: number;
      execution: number | null;
    }[];
  };
  insights: { title: string; body: string }[];
};
export type Asset = {
  id: string;
  name: string;
  type: string;
  domain: string;
  description: string;
  owner: string;
  rows: number;
  columns: { name: string; type: string; pk: number }[];
  updatedAt: string;
};
export type Catalog = {
  assets: Asset[];
  edges: { source: string; target: string }[];
  pipelines: {
    id: number;
    name: string;
    status: string;
    finished_at: string;
    processed_rows: number;
  }[];
  updatedAt: string;
};
export type OrderList = {
  page: number;
  pageSize: number;
  total: number;
  items: {
    id: number;
    customer: string;
    grade: string;
    store: string;
    channel: string;
    date: string;
    amount: number;
    method: string;
  }[];
};
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch(path, options);
  if (!r.ok) {
    let message = "서버 연결을 확인하세요.";
    try {
      message = (await r.json()).error || message;
    } catch {
      /* Non-JSON proxy error. */
    }
    throw new Error(message);
  }
  return r.json();
}
export function useApi<T>(path: string | null, revision = 0) {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: true, error: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: "" });
    request<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState({ data: null, loading: false, error: e.message });
      });
    return () => controller.abort();
  }, [path, revision]);
  return state;
}
