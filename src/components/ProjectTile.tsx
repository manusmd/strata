import { useState } from "react";
import { initials } from "../api";

/** The project's logo (found in its repos), or its initials on the project color. */
export function ProjectTile({ name, color, logo, size = 18 }: { name: string; color: string; logo?: string | null; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const radius = Math.round(size * 0.28);
  if (logo && broken !== logo) {
    return (
      <div className="project-tile has-logo" style={{ width: size, height: size, borderRadius: radius }}>
        <img src={logo} alt="" draggable={false} onError={() => setBroken(logo)} />
      </div>
    );
  }
  return (
    <div
      className="project-tile"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: color + "2A",
        color,
        fontSize: Math.max(8, Math.round(size * 0.36)),
      }}
    >
      {initials(name)}
    </div>
  );
}
