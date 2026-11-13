import { LABELS, validVerification } from "../scripts/automation/policy.mjs";
const defaultRepository = "iiii666/ai-prorject-hdfn";
function link(value, repo) {
  return typeof value === "string" &&
    value.startsWith(`https://github.com/${repo}/`)
    ? value
    : null;
}
export function buildBoard(issues, pulls, repository = defaultRepository) {
  const tasks = issues
    .filter(
      (i) =>
        !i.pull_request &&
        (i.labels?.some((l) => LABELS.includes(l.name)) ||
          /## Acceptance criteria/.test(i.body || "")),
    )
    .map((i) => {
      const linked = pulls.filter((p) =>
        new RegExp(`(?:Closes|Fixes|Resolves) #${i.number}(?!\\d)`, "i").test(
          p.body || "",
        ),
      );
      const pr =
        linked.find((p) => p.merged_at) ||
        linked.find((p) => p.state === "open") ||
        linked[0];
      const labels = (i.labels || []).map((l) => l.name);
      let stage = "ready";
      if (
        pr?.merged_at ||
        (i.state === "closed" && i.state_reason !== "not_planned")
      )
        stage = "done";
      else if (
        i.state_reason === "not_planned" ||
        labels.includes("agent:blocked") ||
        (pr?.state === "closed" && !pr.merged_at)
      )
        stage = "blocked";
      else if (pr?.state === "open") stage = pr.draft ? "blocked" : "review";
      else if (labels.includes("agent:running")) stage = "running";
      let report = null;
      try {
        const m = pr?.body?.match(/<!-- ai-workflow-report ([\s\S]*?) -->/);
        const r = m ? JSON.parse(m[1]) : null;
        if (r?.issue === i.number && validVerification(r))
          report = {
            passed: r.passed === true,
            checks: r.checks.map((c) => ({ name: c.name, status: c.status })),
            runUrl: link(r.runUrl, repository),
          };
      } catch {}
      const created = Date.parse(i.created_at),
        published = Date.parse(pr?.created_at);
      const leadMinutes =
        Number.isFinite(created) &&
        Number.isFinite(published) &&
        published >= created
          ? Math.round((published - created) / 60000)
          : null;
      return {
        number: i.number,
        title: String(i.title || ""),
        stage,
        url: link(i.html_url, repository),
        updatedAt: i.updated_at,
        createdAt: i.created_at,
        labels,
        branch: pr?.head?.ref || null,
        automated: !!pr?.head?.ref?.startsWith("agent/issue-"),
        pr: pr
          ? {
              number: pr.number,
              url: link(pr.html_url, repository),
              draft: !!pr.draft,
              merged: !!pr.merged_at,
            }
          : null,
        report,
        leadMinutes,
      };
    });
  return {
    repository,
    source: "github",
    tasks,
    total: tasks.length,
    limited: issues.length === 100 || pulls.length === 100,
    counts: Object.fromEntries(
      ["ready", "running", "review", "blocked", "done"].map((s) => [
        s,
        tasks.filter((t) => t.stage === s).length,
      ]),
    ),
    automationPRs: tasks.filter((t) => t.automated).length,
  };
}
let cached = null,
  pending = null;
export async function developmentBoard({
  fetcher = fetch,
  now = Date.now(),
} = {}) {
  const repository = process.env.DW_GITHUB_REPOSITORY || defaultRepository;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw Error("DW_GITHUB_REPOSITORY 설정을 확인하세요.");
  if (cached?.repository === repository && now - cached.time < 60000)
    return { ...cached.data, cached: true };
  if (pending) return pending;
  pending = (async () => {
    const get = async (path) => {
      let r;
      try {
        r = await fetcher(
          `https://api.github.com/repos/${repository}/${path}`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "DW-Workflow-Board",
            },
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          },
        );
      } catch {
        throw Error("GitHub 연결에 실패했습니다. 네트워크를 확인하세요.");
      }
      if (!r.ok)
        throw Error(
          r.status === 403 || r.status === 429
            ? "GitHub 공개 API 조회 한도에 도달했습니다. 잠시 후 다시 조회하세요."
            : `GitHub 조회 실패 (${r.status}). 공개 저장소 접근을 확인하세요.`,
        );
      const data = await r.json();
      if (!Array.isArray(data)) throw Error("GitHub 응답 형식을 확인하세요.");
      return data;
    };
    const [issues, prs] = await Promise.all([
      get("issues?state=all&per_page=100"),
      get("pulls?state=all&per_page=100"),
    ]);
    const data = {
      ...buildBoard(issues, prs, repository),
      fetchedAt: new Date(now).toISOString(),
      cached: false,
    };
    cached = { repository, time: now, data };
    return data;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}
