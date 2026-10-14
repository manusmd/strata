import { useEffect, useState } from "react";

/** Same forms the backend accepts: a github.com link (also deep links), git@github.com:…, or owner/name. */
export const looksLikeGithub = (s: string) => /^\s*((https?:\/\/)?(www\.)?github\.com\/|git@github\.com:)?[\w.-]+\/[\w.-]+(\.git)?(\/.*)?\s*$/.test(s) && !s.trim().startsWith("/");

type Props = {
  onLocal: () => void;
  onGithub: (url: string) => Promise<void>;
  onClose: () => void;
};

/** "Add repository": a local folder, or a public GitHub repo Strata clones for you. */
export function AddRepoDialog({ onLocal, onGithub, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = async () => {
    if (!looksLikeGithub(url)) return setError("Paste a link like https://github.com/owner/repo.");
    setBusy(true);
    setError(null);
    try {
      await onGithub(url.trim());
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="docs-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="add-repo glass">
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>Add repository</div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
        <button className="add-repo-option" onClick={() => (onClose(), onLocal())}>
          <span className="add-repo-icon">▤</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 13.5 }}>Local folder</span>
            <span className="faint" style={{ fontSize: 12.5 }}>A repo you have checked out on this Mac</span>
          </span>
          <span className="faint">Choose…</span>
        </button>
        <div className="add-repo-or faint">or</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Public GitHub repo</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              autoFocus
              className="add-repo-input mono"
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={(e) => (setUrl(e.target.value), setError(null))}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button className="btn primary" disabled={!url.trim() || busy} onClick={add}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
          {error ? (
            <div className="error-banner" style={{ fontSize: 12.5 }}>{error}</div>
          ) : (
            <div className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>Strata downloads the latest commit to this Mac and updates it on every rescan. Nothing is uploaded.</div>
          )}
        </div>
      </div>
    </div>
  );
}
