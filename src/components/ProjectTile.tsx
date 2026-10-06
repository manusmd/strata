import { initials } from "../api";

export function ProjectTile({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  return (
    <div
      className="project-tile"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: color + "2A",
        color,
        fontSize: Math.max(8, Math.round(size * 0.36)),
      }}
    >
      {initials(name)}
    </div>
  );
}
