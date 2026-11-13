import { useEffect, useState } from "react";
import { request } from "./api";
import type { SavedApp, Data, Meta } from "./analysis-types";
import AnalysisPreview from "./AnalysisPreview";
import { Panel, timestamp } from "./components";
export function SavedAnalyses({
  meta,
  selectedId,
}: {
  meta: Meta;
  selectedId: string;
}) {
  const [items, setItems] = useState<SavedApp[]>([]),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    request<SavedApp[]>("/api/my-apps")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (selectedId)
      request<Data>("/api/my-apps/" + selectedId + "/data")
        .then(setData)
        .catch((e) => setError(e.message));
  }, [selectedId]);
  return (
    <div className="invest-saved">
      <Panel title="저장한 분석">
        <p className="muted">
          조사 결과에서 확인하고 저장한 분석 화면입니다. 이전에 저장한 분석 앱도
          여기에서 볼 수 있습니다.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="invest-output-grid">
          {items.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                setError("");
                request<Data>("/api/my-apps/" + a.id + "/data")
                  .then(setData)
                  .catch((e) => setError(e.message));
              }}
            >
              <strong>{a.title}</strong>
              <span>
                v{a.version} · {timestamp(a.updated_at)}
              </span>
              <small>
                {a.spec.end
                  ? "조사 기간 고정 · " + a.spec.end + "까지"
                  : "최신 DB 기준 갱신"}
              </small>
            </button>
          ))}
        </div>
        {!items.length && (
          <p className="empty">
            조사 대화에서 “이 결과를 저장하고 매주 확인해줘”라고 요청해보세요.
          </p>
        )}
      </Panel>
      {data && <AnalysisPreview data={data} meta={meta} />}
    </div>
  );
}
