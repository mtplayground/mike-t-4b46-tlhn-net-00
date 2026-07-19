export type ServiceStatus = "ok" | "error";

export interface DatabaseHealthResponse {
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthResponse {
  status: ServiceStatus;
  service: "api";
  product: "The Last Human Network";
  database: DatabaseHealthResponse;
}

export const PRODUCT_NAME = "The Last Human Network";
export const PRODUCT_SHORT_NAME = "TLHN";
export const DEFAULT_POLLING_INTERVAL_MS = 5000;
export const DEFAULT_COUNTDOWN_DEADLINE_ISO = "2029-12-01T07:00:00.000Z";

export const FACTIONS = ["ai_haters", "ai_lovers"] as const;
export type Faction = (typeof FACTIONS)[number];

export const FACTION_DISPLAY_NAMES: Record<Faction, string> = {
  ai_haters: "AI Haters",
  ai_lovers: "AI Lovers",
};

export { createNewsItemRequestSchema } from "./news.js";
export type {
  CreateNewsItemRequest,
  CreateNewsItemResponse,
  ListNewsResponse,
  NewsArticleResponse,
} from "./news.js";
