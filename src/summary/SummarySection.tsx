import { createContext, useContext, useEffect, useMemo } from "react";
import type { Project } from "../api";
import { summaryStore, useSummaries } from "./store";
import type { Subject } from "./subjects";

/** The open project's AI setting, and how to turn it on — available to every inspector. */
export const AiContext = createContext<{ project: Project; enable: () => void; openSettings: () => void } | null>(null);

function timeAgo(secs: number) {
  const d = Date.now() / 1000 - secs;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return `${Math.round(d / 86400)}d ago`;
}

/**
 * "✦ AI summary" in an inspector. In "click" and "auto" mode it writes the
 * summary as soon as the item is selected (or when the item changed since).
 */
export function SummarySection({ subject }: { subject: () => Subject | null }) {
  const ai = useContext(AiContext);
  const project = ai?.project;
  const entries = useSummaries(project?.id ?? "");
  // Building the subject walks the model; do it once per selection.
  const subj = useMemo(subject, [subject]);
  const entry = subj ? entries[subj.nodeId] : undefined;
  const on = !!project && project.aiMode !== "off";
  const outdated = !!entry?.summary && !!subj && entry.summary.hash !== subj.hash;

  useEffect(() => {
    if (!on || !project || !subj) return;
    if (summaryStore.needs(project.id, subj) && !entry?.error) summaryStore.request(project, subj, { priority: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, project?.id, subj?.nodeId, subj?.hash]);

  if (!project || !subj) return null;

  if (!on) {
    return (
      <div className="ai-summary off">
        <div className="ai-head">
          <span className="ai-spark">✦</span> AI summary
        </div>
        <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
          Let Claude explain this in two sentences. Turning it on sends the relevant code to Claude through your Claude Code login.
        </div>
        <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={ai!.enable}>
          Turn on for {project.name}
        </button>
      </div>
    );
  }

  return (
    <div className={`ai-summary ${entry?.pending ? "pending" : ""}`}>
      <div className="ai-head">
        <span className="ai-spark">✦</span> AI summary
        {outdated && !entry?.pending && <span className="ai-badge">outdated</span>}
        <span className="ai-meta">
          {entry?.pending ? "Writing…" : entry?.summary ? `${entry.summary.model} · ${timeAgo(entry.summary.createdAt)}` : ""}
        </span>
        {!entry?.pending && (entry?.summary || entry?.error) && (
          <button className="ai-regen" title="Write it again" onClick={() => summaryStore.request(project, subj, { priority: true })}>
            ↻
          </button>
        )}
      </div>
      {entry?.summary ? (
        <div className={`ai-text ${entry.pending || outdated ? "dim" : ""}`}>{entry.summary.text}</div>
      ) : entry?.pending ? (
        <div className="ai-shimmer">
          <span />
          <span />
          <span style={{ width: "60%" }} />
        </div>
      ) : null}
      {entry?.error && <div className="error-banner" style={{ fontSize: 12 }}>{entry.error}</div>}
    </div>
  );
}
