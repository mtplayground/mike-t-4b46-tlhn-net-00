import { z } from "zod";
import { FACTIONS, type Faction } from "./index.js";

export const factionSchema = z.enum(FACTIONS);

export const listMessagesQuerySchema = z
  .object({
    faction: factionSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    before_id: z.coerce.number().int().min(1).optional(),
  })
  .strict();

export const createMessageRequestSchema = z
  .object({
    faction: factionSchema,
    display_name: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(1000),
  })
  .strict();

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;

export const MESSAGE_POST_COOLDOWN_MS = 30_000;

export interface MessageResponse {
  id: number;
  faction: Faction;
  display_name: string;
  body: string;
  user: string | null;
  created_at: string;
}

export interface ListMessagesResponse {
  has_more: boolean;
  messages: MessageResponse[];
}

export interface CreateMessageResponse {
  message: MessageResponse;
}

export interface MessagePostRateLimitResponse {
  error: "Message post cooldown active";
  cooldown_ms: number;
  retry_after_ms: number;
  retry_after_seconds: number;
  next_allowed_at: string;
}
