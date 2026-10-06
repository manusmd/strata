/** Three stacked glass planes with a glowing dot — ported from StrataLogo.dc.html. */
export function StrataLogo({ size = 120, mono = false, color = "#FFFFFF" }: { size?: number; mono?: boolean; color?: string }) {
  const k = size / 120;
  const glass = "inset 0 1px 0 rgba(255,255,255,.55), inset 0 0 14px rgba(255,255,255,.14), 0 10px 24px rgba(0,0,0,.28)";
  const planes = mono
    ? [
        { top: 48, bg: color, border: "transparent", opacity: 0.28 },
        { top: 28, bg: color, border: "transparent", opacity: 0.55 },
        { top: 8, bg: color, border: "transparent", opacity: 1 },
      ]
    : [
        { top: 48, bg: "rgba(20,184,166,.30)", border: "rgba(125,230,215,.5)", opacity: 1 },
        { top: 28, bg: "rgba(139,92,246,.30)", border: "rgba(200,175,255,.5)", opacity: 1 },
        { top: 8, bg: "rgba(99,102,241,.34)", border: "rgba(175,178,255,.6)", opacity: 1 },
      ];

  return (
    <div style={{ width: size, height: size, position: "relative", flex: "none" }} aria-hidden>
      <div style={{ position: "absolute", left: 0, top: 0, width: 120, height: 120, transform: `scale(${k})`, transformOrigin: "0 0" }}>
        {planes.map((p) => (
          <div
            key={p.top}
            style={{
              position: "absolute",
              left: 28,
              top: p.top,
              width: 64,
              height: 64,
              borderRadius: 16,
              transform: "scaleY(.58) rotate(45deg)",
              background: p.bg,
              border: `1.5px solid ${p.border}`,
              boxShadow: mono ? "none" : glass,
              opacity: p.opacity,
              backdropFilter: mono ? undefined : "blur(6px)",
            }}
          />
        ))}
        {!mono && (
          <>
            <div style={{ position: "absolute", left: 59.5, top: 36, width: 1, height: 64, background: "linear-gradient(to bottom, rgba(255,255,255,.9), rgba(255,255,255,.12))" }} />
            <div
              style={{
                position: "absolute",
                left: 55,
                top: 35,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#FFFFFF",
                boxShadow: "0 0 0 2px rgba(255,255,255,.25), 0 0 12px 3px rgba(129,140,248,.9), 0 0 28px 8px rgba(99,102,241,.45)",
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
