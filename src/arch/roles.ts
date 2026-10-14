import type { ArchKind } from "../map/archModel";
import type { PlanType } from "../plan/model";

/**
 * Architectural roles, in reading order: the map goes from what users touch on the left
 * to what's outside the system on the right. Used by AI sections, the plan canvas and Docs.
 */
export const ROLES = ["Clients", "APIs & services", "Workers & jobs", "Shared code", "Data & storage", "External services"] as const;

export const ARCH_ROLE: Record<ArchKind, number> = {
  App: 0, Extension: 0, CLI: 0,
  Service: 1, Proxy: 1,
  Worker: 2,
  Library: 3, Missing: 3,
  Database: 4, Cache: 4, Queue: 4, Storage: 4, Search: 4, Infra: 4,
  AI: 5, Mail: 5, External: 5,
};

export const PLAN_ROLE: Record<PlanType, number> = { App: 0, Service: 1, Worker: 2, Library: 3, Database: 4, Queue: 4, External: 5 };
