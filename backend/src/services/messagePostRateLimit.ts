import type { Request } from "express";
import { MESSAGE_POST_COOLDOWN_MS } from "@tlhn/shared/messages";

export interface MessagePostRateLimitAllowed {
  allowed: true;
  key: string;
  cooldownMs: number;
  nextAllowedAt: number;
}

export interface MessagePostRateLimitDenied {
  allowed: false;
  key: string;
  cooldownMs: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
  nextAllowedAt: number;
}

export type MessagePostRateLimitDecision =
  | MessagePostRateLimitAllowed
  | MessagePostRateLimitDenied;

export class MessagePostRateLimiter {
  private readonly nextAllowedAtByKey = new Map<string, number>();

  constructor(
    private readonly cooldownMs = MESSAGE_POST_COOLDOWN_MS,
    private readonly getNow = () => Date.now(),
  ) {}

  reserve(key: string): MessagePostRateLimitDecision {
    const now = this.getNow();
    this.deleteExpiredEntries(now);

    const nextAllowedAt = this.nextAllowedAtByKey.get(key);
    if (nextAllowedAt && nextAllowedAt > now) {
      const retryAfterMs = nextAllowedAt - now;

      return {
        allowed: false,
        key,
        cooldownMs: this.cooldownMs,
        retryAfterMs,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        nextAllowedAt,
      };
    }

    const reservedUntil = now + this.cooldownMs;
    this.nextAllowedAtByKey.set(key, reservedUntil);

    return {
      allowed: true,
      key,
      cooldownMs: this.cooldownMs,
      nextAllowedAt: reservedUntil,
    };
  }

  release(key: string, nextAllowedAt: number): void {
    if (this.nextAllowedAtByKey.get(key) === nextAllowedAt) {
      this.nextAllowedAtByKey.delete(key);
    }
  }

  private deleteExpiredEntries(now: number): void {
    for (const [key, nextAllowedAt] of this.nextAllowedAtByKey.entries()) {
      if (nextAllowedAt <= now) {
        this.nextAllowedAtByKey.delete(key);
      }
    }
  }
}

export function getMessagePostRateLimitKey(req: Request): string {
  const forwardedFor = getFirstHeaderValue(req, "x-forwarded-for");
  const flyClientIp = getFirstHeaderValue(req, "fly-client-ip");
  const cfConnectingIp = getFirstHeaderValue(req, "cf-connecting-ip");
  const realIp = getFirstHeaderValue(req, "x-real-ip");
  const remoteAddress = req.socket.remoteAddress;

  return (
    forwardedFor ||
    flyClientIp ||
    cfConnectingIp ||
    realIp ||
    req.ip ||
    remoteAddress ||
    "unknown-client"
  );
}

function getFirstHeaderValue(req: Request, name: string): string | undefined {
  const rawValue = req.headers[name];
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

  if (!value) {
    return undefined;
  }

  return value.split(",")[0]?.trim() || undefined;
}
