import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ORIGIN_LABEL, type DbTable, type GhostTable } from "./dbModel";
import { visibleColumns } from "./dbLayout";
import type { Highlight } from "./nodes";

export type TableNodeData = { table: DbTable; expanded: boolean; onToggle: (id: string) => void; highlight: Highlight; related: Set<string>; hubCount?: number };
export type DbGroupNodeData = { label: string; count: number; highlight: Highlight };
export type GhostTableNodeData = { ghost: GhostTable; highlight: Highlight };
export type DbRepoNodeData = { name: string; count: number; color: string };

const hidden = "map-handle";

export const TableNode = memo(({ data }: NodeProps<Node<TableNodeData>>) => {
  const { table, expanded, onToggle } = data;
  const cols = visibleColumns(table, new Set(expanded ? [table.id] : []));
  const more = table.columns.length - cols.length;
  const uses = new Set([...table.readers, ...table.writers]).size;
  const selfRef = table.columns.some((c) => c.fk && c.fk.table === table.name);
  return (
    <div className={`db-table hl-${data.highlight ?? "none"}`}>
      <Handle type="target" position={Position.Left} id="t-header" isConnectable={false} className={hidden} style={{ top: 22 }} />
      <Handle type="source" position={Position.Right} id="s-header" isConnectable={false} className={hidden} style={{ top: 22 }} />
      <div className="db-table-header">
        <span className="db-table-icon">▦</span>
        <span className="db-table-name">{table.name}</span>
        {selfRef && <span className="db-badge" title="References itself">↺</span>}
        {data.hubCount ? <span className="db-hub" title={`Referenced by ${data.hubCount} tables. Its lines show when you select it.`}>← {data.hubCount}</span> : null}
        <span className="db-origin">{ORIGIN_LABEL[table.origin]}</span>
      </div>
      <div className="db-table-far">{table.name}</div>
      <div className="db-cols">
        {cols.map((c) => (
          <div key={c.name} className={`db-col ${data.related.has(c.name) ? "related" : ""}`}>
            <Handle type="target" position={Position.Left} id={`t-${c.name}`} isConnectable={false} className={hidden} />
            <Handle type="source" position={Position.Right} id={`s-${c.name}`} isConnectable={false} className={hidden} />
            <span className={`db-key ${c.pk ? "pk" : c.fk ? "fk" : ""}`}>{c.pk ? "PK" : c.fk ? "FK" : ""}</span>
            <span className="db-col-name">{c.name}</span>
            <span className="db-col-type">
              {c.type}
              {c.nullable && !c.pk ? "?" : ""}
            </span>
          </div>
        ))}
        {(more > 0 || expanded) && (
          <button
            className="db-more nodrag"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(table.id);
            }}
          >
            {expanded ? "Show fewer columns" : `+ ${more} more columns`}
          </button>
        )}
      </div>
      <div className="db-table-footer">
        {uses > 0 ? (
          <>
            <span className="db-use r">{table.readers.length} read</span>
            <span className="db-use w">{table.writers.length} write</span>
            <span className="faint">in {uses} {uses === 1 ? "file" : "files"}</span>
          </>
        ) : (
          <span className="faint">No code uses this table</span>
        )}
      </div>
    </div>
  );
});

export const GhostTableNode = memo(({ data }: NodeProps<Node<GhostTableNodeData>>) => (
  <div className={`map-ghost db-ghost hl-${data.highlight ?? "none"}`}>
    <Handle type="target" position={Position.Left} id="t-header" isConnectable={false} className={hidden} style={{ top: 26 }} />
    <div className="map-ghost-top">
      <span className="map-ghost-badge">table</span>
      <span className="map-ghost-name">{data.ghost.name}</span>
    </div>
    <div className="map-ghost-sub">Referenced by {data.ghost.referencedBy.length} {data.ghost.referencedBy.length === 1 ? "table" : "tables"} · not defined here</div>
  </div>
));

export const DbGroupNode = memo(({ data }: NodeProps<Node<DbGroupNodeData>>) => (
  <div className={`map-folder hl-${data.highlight ?? "none"}`}>
    <div className="map-folder-header">
      <span className="map-folder-name">{data.label}</span>
      <span className="map-folder-meta">{data.count} tables</span>
    </div>
  </div>
));

export const DbRepoNode = memo(({ data }: NodeProps<Node<DbRepoNodeData>>) => (
  <div className="map-repo" style={{ ["--repo" as any]: data.color }}>
    <div className="map-repo-header">
      <span className="map-repo-dot" />
      <span className="map-repo-name">{data.name}</span>
      <span className="map-repo-meta">{data.count} tables</span>
    </div>
  </div>
));
