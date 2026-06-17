import {
  DEFAULT_COUNTDOWN_DEADLINE_ISO,
  DEFAULT_POLLING_INTERVAL_MS,
} from "@tlhn/shared";

export interface ServerConfig {
  databaseUrl: string;
  host: string;
  port: number;
  nodeEnv: string;
  pollingIntervalMs: number;
  countdownDeadlineIso: string;
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePort(value: string | undefined, name = "PORT"): number {
  if (!value) {
    return 8080;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return port;
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}

function parseIsoDate(
  value: string | undefined,
  name: string,
  fallback: string,
): string {
  const candidate = value || fallback;
  const timestamp = Date.parse(candidate);

  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid ${name} value: ${candidate}`);
  }

  return new Date(timestamp).toISOString();
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    databaseUrl: normalizeDatabaseUrl(requireEnv(env.DATABASE_URL, "DATABASE_URL")),
    host: env.HOST || "0.0.0.0",
    port: parsePort(env.PORT),
    nodeEnv: env.NODE_ENV || "development",
    pollingIntervalMs: parsePositiveInteger(
      env.POLLING_INTERVAL_MS,
      "POLLING_INTERVAL_MS",
      DEFAULT_POLLING_INTERVAL_MS,
    ),
    countdownDeadlineIso: parseIsoDate(
      env.COUNTDOWN_DEADLINE_ISO,
      "COUNTDOWN_DEADLINE_ISO",
      DEFAULT_COUNTDOWN_DEADLINE_ISO,
    ),
  };
}

function normalizeDatabaseUrl(value: string): string {
  const url = new URL(value);

  if (
    url.searchParams.get("sslmode") === "require" &&
    !url.searchParams.has("uselibpqcompat")
  ) {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}
