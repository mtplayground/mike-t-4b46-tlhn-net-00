import { z } from "zod";
import { FACTIONS, type Faction } from "./index.js";

export const factionSchema = z.enum(FACTIONS);

export const listMessagesQuerySchema = z
  .object({
    faction: factionSchema.optional(),
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

export interface MessageResponse {
  id: number;
  faction: Faction;
  display_name: string;
  body: string;
  user: string | null;
  created_at: string;
}

export interface ListMessagesResponse {
  messages: MessageResponse[];
}

export interface CreateMessageResponse {
  message: MessageResponse;
}
