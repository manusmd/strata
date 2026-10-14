import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Graph, Project } from "../api";
import { buildCodeModel, type CodeModel } from "../map/model";
import { SummarySection } from "../summary/SummarySection";
import { fileSubject } from "../summary/subjects";

const EDITORS = [
  ["vscode", "VS Code"],
  ["cursor", "Cursor"],
  ["windsurf", "Windsurf"],
  ["zed", "Zed"],
] as const;
type Editor = (typeof EDITORS)[number][0];
const EDITOR_KEY = "strata-editor";
const KIND_ICON: Record<string, string> = { function: "ƒ", class: "C", type: "T", interface: "I", const: "k", enum: "E" };

type Props = {
  project: Project;
  graph: Graph;
  /** Shared across opens: building the code model of a big project isn't free. */
  code: CodeModel;
  fileId: string;
  /** Line to show, e.g. a symbol's. */
  line?: number;
  onOpenFile: (fileId: string, line?: number) => void;
  onOpenTable: (tableId: string) => void;
  /** Opens the file's component on the Architecture page, zoomed into its code. */
  onShowInArchitecture?: (fileId: string) => void;
  onClose: () => void;
};

/** A file, wherever it was clicked: the code, what it declares, what it imports and who imports it. */
export function FilePanel({ project, graph, code, fileId, line, onOpenFile, onOpenTable, onShowInArchitecture, onClose }: Props) {
  const f = code.files.get(fileId);
  const repo = project.repos.find((r) => r.id === f?.repoId);
  const abs = f && repo ? `${repo.path}/${f.path}` : "";
  const [source, setSource] = useState<{ id: string; text?: string; error?: string } | null>(null);
  const [editor, setEditor] = useState<Editor>(() => {
    try {
      return (localStorage.getItem(EDITOR_KEY) as Editor) || "vscode";
    } catch {
      return "vscode";
    }
  });
  const [mark, setMark] = useState<number | undefined>(line);
  const pre = useRef<HTMLDivElement>(null);

  useEffect(() => setMark(line), [fileId, line]);
  useEffect(() => {
    if (!f) return;
    let cancelled = false;
    setSource({ id: f.id });
    invoke<string>("read_source", { repoId: f.repoId, path: f.path })
      .then((text) => !cancelled && setSource({ id: f.id, text }))
      .catch((e) => !cancelled && setSource({ id: f.id, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [f]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Scroll the preview to the marked line once the source is there.
  useEffect(() => {
    if (!mark || !source?.text) return;
    pre.current?.querySelector(`[data-line="${mark}"]`)?.scrollIntoView({ block: "center" });
  }, [mark, source?.text]);

  const lines = useMemo(() => source?.text?.split("\n") ?? [], [source?.text]);
  const symbolAt = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of f?.symbols ?? []) if (s.meta?.line) for (let l = s.meta.line; l < s.meta.line + Math.max(1, s.meta?.lines ?? 1); l++) m.set(l, s.meta.line);
    return m;
  }, [f]);

  if (!f) return null;
  const open = (ed: Editor, at?: number) => {
    setEditor(ed);
    try {
      localStorage.setItem(EDITOR_KEY, ed);
    } catch {}
    invoke("open_in_editor", { editor: ed, path: abs, line: at ?? mark ?? null }).catch((e) => alert(String(e)));
  };
  const fileName = (id: string) => code.files.get(id)?.path ?? id;
  const ext = f.name.split(".").pop()!.toUpperCase().slice(0, 3);
  const markedSymbol = mark ? symbolAt.get(mark) : undefined;

  return (
    <aside className="file-panel glass">
      <div className="file-head">
        <div className="insp-tile" style={{ background: "#6366F124", color: "#6366F1", borderColor: "#6366F180" }}>{ext}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="insp-title">{f.name}</div>
          <div className="insp-meta mono">
            {project.repos.length > 1 ? `${repo?.name}/` : ""}
            {f.path} · {f.lines} lines
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="file-actions">
        <div className="seg file-editor">
          <button className="on" onClick={() => open(editor)} title={`Open in ${EDITORS.find(([k]) => k === editor)?.[1]}${mark ? ` at line ${mark}` : ""}`}>
            Open in {EDITORS.find(([k]) => k === editor)?.[1]}
          </button>
          <select value={editor} onChange={(e) => open(e.target.value as Editor)} title="Choose your editor">
            {EDITORS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button className="btn small ghost" onClick={() => revealItemInDir(abs).catch(() => {})}>
          Reveal in Finder
        </button>
        {onShowInArchitecture && (
          <button className="btn small ghost" onClick={() => onShowInArchitecture(f.id)}>
            Show in Architecture
          </button>
        )}
      </div>

      <div className="file-body">
        <SummarySection subject={() => fileSubject(project, code, graph, f.id)} />

        <div className="file-code" ref={pre}>
          {source?.error ? (
            <div className="faint" style={{ padding: 14, fontSize: 12.5 }}>{source.error}</div>
          ) : !source?.text ? (
            <div className="faint" style={{ padding: 14, fontSize: 12.5 }}>Reading…</div>
          ) : (
            lines.map((l, i) => {
              const n = i + 1;
              const inMarked = markedSymbol !== undefined && symbolAt.get(n) === markedSymbol;
              return (
                <div key={i} data-line={n} className={`file-line ${n === mark ? "mark" : inMarked ? "in" : ""}`} onClick={() => setMark(n)}>
                  <span>{n}</span>
                  <span>{l || " "}</span>
                </div>
              );
            })
          )}
        </div>

        {f.symbols.length > 0 && (
          <div className="insp-section">
            <div className="insp-label">Declares · {f.symbols.length}</div>
            {f.symbols.map((s) => (
              <div key={s.id} className={`insp-row link ${markedSymbol === s.meta?.line ? "on" : ""}`} onClick={() => setMark(s.meta?.line)}>
                <span className="insp-sym">{KIND_ICON[s.meta?.symbolKind] ?? "·"}</span>
                <span className="mono grow">{s.name}</span>
                {s.meta?.exported && <span className="faint">exported</span>}
                <span className="faint">:{s.meta?.line}</span>
              </div>
            ))}
          </div>
        )}
        {f.tables.length > 0 && (
          <div className="insp-section">
            <div className="insp-label">Database</div>
            {f.tables.map((t) => (
              <div key={t.id} className="insp-row link" onClick={() => onOpenTable(t.id)}>
                <span className="insp-bullet" style={{ background: "var(--db)" }} />
                <span className="mono grow">{t.name}</span>
                <span className="faint">{t.read && t.write ? "reads & writes" : t.write ? "writes" : "reads"}</span>
              </div>
            ))}
          </div>
        )}
        {f.imports.length + f.packages.length > 0 && (
          <div className="insp-section">
            <div className="insp-label">Imports · {f.imports.length + f.packages.length}</div>
            {f.imports.map((id) => (
              <div key={id} className="insp-row link" onClick={() => onOpenFile(id)}>
                <span className="insp-bullet" />
                <span className="mono grow">{fileName(id)}</span>
              </div>
            ))}
            {f.packages.map((p) => (
              <div key={p} className="insp-row">
                <span className="insp-bullet pkg" />
                <span className="mono grow">{p}</span>
                <span className="faint">package</span>
              </div>
            ))}
          </div>
        )}
        <div className="insp-section">
          <div className="insp-label">Imported by · {f.importedBy.length}</div>
          {f.importedBy.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: "2px 6px" }}>Nothing in the project imports it.</div>}
          {f.importedBy.slice(0, 40).map((id) => (
            <div key={id} className="insp-row link" onClick={() => onOpenFile(id)}>
              <span className="insp-bullet" />
              <span className="mono grow">{fileName(id)}</span>
            </div>
          ))}
          {f.importedBy.length > 40 && <div className="faint" style={{ fontSize: 12, padding: "2px 6px" }}>+ {f.importedBy.length - 40} more</div>}
        </div>
      </div>
    </aside>
  );
}

/** One code model per graph, shared by the panel and the drill-down. */
export function useCodeModel(graph: Graph | null, project: Project) {
  return useMemo(() => (graph ? buildCodeModel(graph, project.repos) : null), [graph, project.repos]);
}
