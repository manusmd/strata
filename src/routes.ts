export type Lens = "home" | "plan" | "code" | "arch" | "db";

export type Route =
  | { page: "projects" }
  | { page: "create" }
  | { page: "project"; id: string; lens: Lens }
  | { page: "settings"; id: string };

export const LENSES: { id: Lens; label: string; color: string }[] = [
  { id: "home", label: "Overview", color: "var(--warn)" },
  { id: "plan", label: "Plan", color: "var(--arch)" },
  { id: "code", label: "Code", color: "var(--code)" },
  { id: "arch", label: "Architecture", color: "var(--arch)" },
  { id: "db", label: "Database", color: "var(--db)" },
];
