import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { Cluster, FileInfo, FolderGroup, GhostPackage, RepoBox } from "./model";
import { COLLAPSED_ROWS } from "./layout";

export type Highlight = "selected" | "related" | "dim" | null;

export type RepoNodeData = { repo: RepoBox; color: string; highlight: Highlight };
export type ClusterNodeData = { cluster: Cluster; label: string; expanded: boolean; onToggle: (id: string) => void; highlight: Highlight };
export type FolderNodeData = { group: FolderGroup; highlight: Highlight };
export type FileNodeData = { file: FileInfo; highlight: Highlight };
export type GhostNodeData = { ghost: GhostPackage; highlight: Highlight };

// Invisible handles: edges attach left/right, but nodes aren't connectable.
const Handles = () => (
  <>
    <Handle type="target" position={Position.Left} isConnectable={false} className="map-handle" />
    <Handle type="source" position={Position.Right} isConnectable={false} className="map-handle" />
  </>
);

export const RepoNode = memo(({ data }: NodeProps<Node<RepoNodeData>>) => (
  <div className={`map-repo hl-${data.highlight ?? "none"}`} style={{ ["--repo" as any]: data.color }}>
    <div className="map-repo-header">
      <span className="map-repo-dot" />
      <span className="map-repo-name">{data.repo.name}</span>
      <span className="map-repo-meta">{data.repo.fileCount} files</span>
    </div>
  </div>
));

export const ClusterNode = memo(({ data }: NodeProps<Node<ClusterNodeData>>) => {
  const { cluster, expanded, onToggle } = data;
  const hidden = cluster.files.length - COLLAPSED_ROWS;
  return (
    <div className={`map-cluster hl-${data.highlight ?? "none"}`}>
      <Handles />
      <div className="map-cluster-header">
        <span className="map-cluster-name" title={cluster.dir || "/"}>
          {data.label}
        </span>
        <span className="map-cluster-count">{cluster.files.length} files</span>
      </div>
      <div className="map-cluster-title-far">{data.label}</div>
      {hidden > 0 && (
        <button
          className="map-cluster-more nodrag"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(cluster.id);
          }}
        >
          {expanded ? "Show fewer" : `+ ${hidden} more files`}
        </button>
      )}
    </div>
  );
});

function langBadge(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return { ts: "TS", tsx: "TSX", mts: "TS", cts: "TS", js: "JS", jsx: "JSX", mjs: "JS", cjs: "JS" }[ext] ?? ext.toUpperCase();
}

export const FileNode = memo(({ data }: NodeProps<Node<FileNodeData>>) => {
  const { file } = data;
  const fns = file.symbols.length;
  return (
    <div className={`map-file hl-${data.highlight ?? "none"}`} title={file.path}>
      <Handles />
      <span className="map-file-badge">{langBadge(file.name)}</span>
      <span className="map-file-name">{file.name}</span>
      {fns > 0 && <span className="map-file-symbols">{fns} sym</span>}
      <span className="map-file-loc">{file.lines} loc</span>
      <span className="map-file-skeleton" />
    </div>
  );
});

export const FolderNode = memo(({ data }: NodeProps<Node<FolderNodeData>>) => (
  <div className={`map-folder hl-${data.highlight ?? "none"}`}>
    <Handles />
    <div className="map-folder-header" title={data.group.dir}>
      <span className="map-folder-name">{data.group.label}</span>
      <span className="map-folder-meta">{data.group.fileCount} files</span>
    </div>
  </div>
));

export const GhostNode = memo(({ data }: NodeProps<Node<GhostNodeData>>) => (
  <div className={`map-ghost hl-${data.highlight ?? "none"}`}>
    <Handles />
    <div className="map-ghost-top">
      <span className="map-ghost-badge">npm</span>
      <span className="map-ghost-name">{data.ghost.name}</span>
    </div>
    <div className="map-ghost-sub">
      Not declared · imported in {data.ghost.uses} {data.ghost.uses === 1 ? "file" : "files"}
    </div>
  </div>
));

export type LabelNodeData = { text: string; meta: string; repo?: boolean; color?: string };

/** Screen-sized label for repos and folders in the far-out zoom levels. */
export const LabelNode = memo(({ data }: NodeProps<Node<LabelNodeData>>) => (
  <div className={`map-label ${data.repo ? "repo" : ""}`} style={data.color ? { ["--repo" as any]: data.color } : undefined}>
    {data.repo && <span className="map-repo-dot" />}
    <span className="map-label-text">{data.text}</span>
    <span className="map-label-meta">{data.meta}</span>
  </div>
));

export const nodeTypes = { repo: RepoNode, folder: FolderNode, label: LabelNode, cluster: ClusterNode, file: FileNode, ghost: GhostNode };
