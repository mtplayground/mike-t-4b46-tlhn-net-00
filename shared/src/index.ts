export type ServiceStatus = "ok";

export interface HealthResponse {
  status: ServiceStatus;
  service: "api";
  product: "The Last Human Network";
}

export const PRODUCT_NAME = "The Last Human Network";
export const PRODUCT_SHORT_NAME = "TLHN";
