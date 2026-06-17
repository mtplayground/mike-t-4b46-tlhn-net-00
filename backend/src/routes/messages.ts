import { desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  createMessageRequestSchema,
  listMessagesQuerySchema,
  type MessageResponse,
} from "@tlhn/shared/messages";
import type { AppDatabase } from "../db/client.js";
import { messages, type Message } from "../db/schema.js";

const RECENT_MESSAGE_LIMIT = 50;

export interface MessagesRouterDependencies {
  db: AppDatabase;
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
      const rows = query.data.faction
        ? await dependencies.db
            .select()
            .from(messages)
            .where(eq(messages.faction, query.data.faction))
            .orderBy(desc(messages.createdAt))
            .limit(RECENT_MESSAGE_LIMIT)
        : await dependencies.db
            .select()
            .from(messages)
            .orderBy(desc(messages.createdAt))
            .limit(RECENT_MESSAGE_LIMIT);

      res.json({
        messages: rows.map(toMessageResponse),
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
