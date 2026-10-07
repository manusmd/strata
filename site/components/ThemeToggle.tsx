"use client";

/** Switches between dark and light; remembered for the next visit. */
export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("strata-site-theme", next);
    } catch {}
  };
  return (
    <button className="icon-btn" onClick={toggle} aria-label="Toggle light and dark mode" title="Light / dark">
      <span style={{ width: 13, height: 13, borderRadius: "50%", border: "1.5px solid var(--text-2)", background: "linear-gradient(90deg, var(--text-2) 50%, transparent 50%)" }} />
    </button>
  );
}
