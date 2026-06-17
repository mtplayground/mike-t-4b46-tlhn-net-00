import {
  DEFAULT_COUNTDOWN_DEADLINE_ISO,
  DEFAULT_POLLING_INTERVAL_MS,
} from "@tlhn/shared";

export interface ClientConfig {
  pollingIntervalMs: number;
  countdownDeadlineIso: string;
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  if (!value) {
    return DEFAULT_POLLING_INTERVAL_MS;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }

  return parsed;
}

function parseIsoDate(value: string | undefined, name: string): string {
  const candidate = value || DEFAULT_COUNTDOWN_DEADLINE_ISO;
  const timestamp = Date.parse(candidate);

  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid ${name} value: ${candidate}`);
  }

  return new Date(timestamp).toISOString();
}

export const clientConfig: ClientConfig = {
  pollingIntervalMs: parsePositiveInteger(
    import.meta.env.VITE_POLLING_INTERVAL_MS,
    "VITE_POLLING_INTERVAL_MS",
  ),
  countdownDeadlineIso: parseIsoDate(
    import.meta.env.VITE_COUNTDOWN_DEADLINE_ISO,
    "VITE_COUNTDOWN_DEADLINE_ISO",
  ),
};
