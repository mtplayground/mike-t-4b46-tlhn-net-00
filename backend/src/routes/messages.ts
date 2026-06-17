import { and, desc, eq, lt } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  createMessageRequestSchema,
  listMessagesQuerySchema,
  type MessageResponse,
} from "@tlhn/shared/messages";
import type { AppDatabase } from "../db/client.js";
import { messages, type Message } from "../db/schema.js";
import {
  getMessagePostRateLimitKey,
  type MessagePostRateLimitDenied,
  type MessagePostRateLimiter,
} from "../services/messagePostRateLimit.js";

export interface MessagesRouterDependencies {
  db: AppDatabase;
  rateLimiter: MessagePostRateLimiter;
}

export function createMessagesRouter(dependencies: MessagesRouterDependencies): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response, next) => {
    const query = listMessagesQuerySchema.safeParse(req.query);

    if (!query.success) {
      res.status(400).json({
        error: "Invalid message query",
        issues: query.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const fetchLimit = query.data.limit + 1;
      const rows =
        query.data.faction && query.data.before_id
          ? await dependencies.db
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.faction, query.data.faction),
                  lt(messages.id, query.data.before_id),
                ),
              )
              .orderBy(desc(messages.id))
              .limit(fetchLimit)
          : query.data.faction
            ? await dependencies.db
                .select()
                .from(messages)
                .where(eq(messages.faction, query.data.faction))
                .orderBy(desc(messages.id))
                .limit(fetchLimit)
            : query.data.before_id
              ? await dependencies.db
                  .select()
                  .from(messages)
                  .where(lt(messages.id, query.data.before_id))
                  .orderBy(desc(messages.id))
                  .limit(fetchLimit)
              : await dependencies.db
                  .select()
                  .from(messages)
                  .orderBy(desc(messages.id))
                  .limit(fetchLimit);
      const pageRows = rows.slice(0, query.data.limit);

      res.json({
        has_more: rows.length > query.data.limit,
        messages: pageRows.map(toMessageResponse),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (req: Request, res: Response, next) => {
    const body = createMessageRequestSchema.safeParse(req.body);

    if (!body.success) {
      res.status(400).json({
        error: "Invalid message payload",
        issues: body.error.flatten().fieldErrors,
      });
      return;
    }

    const rateLimitKey = getMessagePostRateLimitKey(req);
    const rateLimit = dependencies.rateLimiter.reserve(rateLimitKey);

    if (!rateLimit.allowed) {
      sendRateLimitResponse(res, rateLimit);
      return;
    }

    try {
      const [created] = await dependencies.db
        .insert(messages)
        .values({
          faction: body.data.faction,
          displayName: body.data.display_name,
          body: body.data.body,
          user: null,
        })
        .returning();

      if (!created) {
        throw new Error("Message insert returned no row");
      }

      res.status(201).json({
        message: toMessageResponse(created),
      });
    } catch (error) {
      dependencies.rateLimiter.release(rateLimit.key, rateLimit.nextAllowedAt);
      next(error);
    }
  });

  return router;
}

function toMessageResponse(message: Message): MessageResponse {
  return {
    id: message.id,
    faction: message.faction,
    display_name: message.displayName,
    body: message.body,
    user: message.user,
    created_at: message.createdAt.toISOString(),
  };
}

function sendRateLimitResponse(
  res: Response,
  rateLimit: MessagePostRateLimitDenied,
): void {
  res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
  res.status(429).json({
    error: "Message post cooldown active",
    cooldown_ms: rateLimit.cooldownMs,
    retry_after_ms: rateLimit.retryAfterMs,
    retry_after_seconds: rateLimit.retryAfterSeconds,
    next_allowed_at: new Date(rateLimit.nextAllowedAt).toISOString(),
  });
}
