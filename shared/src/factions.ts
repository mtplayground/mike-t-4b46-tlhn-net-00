import { z } from "zod";
import { FACTIONS, type Faction } from "./index.js";

export const factionSchema = z.enum(FACTIONS);

export const factionJoinParamsSchema = z
  .object({
    faction: factionSchema,
  })
  .strict();

export type FactionJoinParams = z.infer<typeof factionJoinParamsSchema>;
export type FactionCounts = Record<Faction, number>;

export interface FactionCountsResponse {
  counts: FactionCounts;
}

export interface FactionJoinResponse {
  faction: Faction;
  counts: FactionCounts;
  joined: true;
  already_joined: boolean;
}
