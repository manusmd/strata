import { Fragment, type ReactNode } from "react";

/** A clickable reference to something on the map. */
export type Ref = { kind: "file" | "table" | "node"; id: string; label: string };

type Props = {
  text: string;
  /** Turns a `strata:` link, or inline code that names a known file/table, into a reference. */
  resolve: (href: string | null, label: string) => Ref | null;
  onRef: (ref: Ref) => void;
  /** Custom rendering for fenced blocks (e.g. ```strata-canvas). `closed` is false while the block is still streaming in. */
  renderBlock?: (lang: string, body: string, closed: boolean) => ReactNode | null;
};

const ICON: Record<Ref["kind"], string> = { file: "TS", table: "▦", node: "◆" };

function RefChip({ r, onRef }: { r: Ref; onRef: (r: Ref) => void }) {
  return (
    <button className={`ask-ref k-${r.kind}`} onClick={() => onRef(r)} title={r.kind === "file" ? "Show in Code view" : r.kind === "table" ? "Show in Database view" : "Show in Architecture view"}>
      <span className="ask-ref-icon">{ICON[r.kind]}</span>
      {r.label}
    </button>
  );
}

function inline(text: string, props: Props, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // links, inline code, bold, italic — in that order of precedence
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|(?<![*\w])\*([^*\n]+)\*(?![*\w])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) {
      const r = props.resolve(m[2], m[1]);
      if (r) out.push(<RefChip key={k} r={r} onRef={props.onRef} />);
      else if (/^https?:/.test(m[2])) out.push(<a key={k} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>);
      else out.push(<span key={k} className="mono ask-code">{m[1]}</span>);
    } else if (m[3] !== undefined) {
      const r = props.resolve(null, m[3]);
      out.push(r ? <RefChip key={k} r={r} onRef={props.onRef} /> : <code key={k} className="ask-code">{m[3]}</code>);
    } else if (m[4] !== undefined) out.push(<strong key={k}>{inline(m[4], props, k)}</strong>);
    else if (m[5] !== undefined) out.push(<em key={k}>{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A small Markdown renderer: paragraphs, headings, lists, code blocks, and inline marks. */
export function Markdown(props: Props) {
  const blocks: ReactNode[] = [];
  const lines = props.text.replace(/\r/g, "").split("\n");
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${n++}`;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      const closed = i < lines.length;
      i++;
      const custom = props.renderBlock?.(lang, body.join("\n"), closed);
      blocks.push(custom ? <Fragment key={key}>{custom}</Fragment> : <pre key={key} className="ask-pre"><code>{body.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={key} className={`ask-h ask-h${h[1].length}`}>{inline(h[2], props, key)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, "");
        i++;
        // Continuation lines belong to the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key} className="ask-list">
          {items.map((it, j) => (
            <li key={j}>{inline(it, props, `${key}-${j}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key}>{para.map((p, j) => <Fragment key={j}>{j > 0 && " "}{inline(p, props, `${key}-${j}`)}</Fragment>)}</p>);
  }
  return <div className="ask-md">{blocks}</div>;
}
