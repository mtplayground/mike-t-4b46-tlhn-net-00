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
