import { useEffect, useState } from "react";
import { Markdown } from "../ask/Markdown";
import { updateStore, useUpdate } from "./store";

/** Bottom-right card: a new version is available, download progress, or the result of a manual check. */
export function UpdateCard() {
  const u = useUpdate();
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (u.manual && u.status === "upToDate") {
      const t = setTimeout(() => updateStore.clear(), 4000);
      return () => clearTimeout(t);
    }
  }, [u.manual, u.status]);

  const offer = u.info && u.dismissed !== u.info.version && (u.status === "available" || u.status === "installing" || (u.status === "error" && u.manual));
  if (offer && u.info) {
    const installing = u.status === "installing";
    return (
      <div className="update-card glass" role="status">
        <div className="update-head">
          <span className="update-badge">New</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="update-title">Strata {u.info.version} is available</div>
            <div className="faint" style={{ fontSize: 11.5 }}>
              You have {u.info.currentVersion}
              {u.info.date ? ` · released ${u.info.date}` : ""}
            </div>
          </div>
        </div>
        {u.info.notes && (
          <>
            <button className="update-notes-toggle" onClick={() => setNotesOpen((o) => !o)}>
              {notesOpen ? "▾" : "▸"} What’s new
            </button>
            {notesOpen && (
              <div className="update-notes">
                <Markdown text={u.info.notes} resolve={() => null} onRef={() => {}} />
              </div>
            )}
          </>
        )}
        {installing && (
          <div className="update-progress">
            <div className={u.progress === null ? "indeterminate" : ""} style={u.progress === null ? undefined : { width: `${Math.round(u.progress * 100)}%` }} />
          </div>
        )}
        {u.status === "error" && <div className="update-error">{u.error}</div>}
        <div className="update-actions">
          {installing ? (
            <span className="faint" style={{ fontSize: 12 }}>{u.progress !== null && u.progress >= 1 ? "Installing… Strata restarts in a moment." : "Downloading…"}</span>
          ) : (
            <>
              <button className="btn small ghost" onClick={() => updateStore.later()}>Later</button>
              <button className="btn small accent" onClick={() => updateStore.install()}>{u.status === "error" ? "Try again" : "Install & restart"}</button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (u.manual && (u.status === "checking" || u.status === "upToDate" || u.status === "error")) {
    return (
      <div className="update-card glass small" role="status">
        <div className="update-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="update-title">{u.status === "checking" ? "Checking for updates…" : u.status === "upToDate" ? "Strata is up to date" : "Couldn’t check for updates"}</div>
            <div className="faint" style={{ fontSize: 11.5 }}>{u.status === "error" ? u.error : `Version ${u.version}`}</div>
          </div>
          {u.status !== "checking" && (
            <button className="icon-btn" onClick={() => updateStore.clear()} title="Close">
              ×
            </button>
          )}
        </div>
      </div>
    );
  }
  return null;
}

/** Sidebar footer: the version, a manual check, and a pill when an update is waiting. */
export function VersionButton() {
  const u = useUpdate();
  if (!u.version) return null;
  if (u.info && (u.status === "available" || u.status === "installing")) {
    return (
      <button className="update-pill" onClick={() => updateStore.show()} title={`Strata ${u.info.version} is available`}>
        Update
      </button>
    );
  }
  return (
    <button className="version-btn" onClick={() => updateStore.check(true)} title="Check for updates">
      v{u.version}
    </button>
  );
}
