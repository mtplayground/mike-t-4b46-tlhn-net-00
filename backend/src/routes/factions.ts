import { sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { FACTIONS, type Faction } from "@tlhn/shared";
import {
  factionJoinParamsSchema,
  type FactionCounts,
  type FactionCountsResponse,
  type FactionJoinResponse,
} from "@tlhn/shared/factions";
import type { AppDatabase } from "../db/client.js";
import { factionCounts, type FactionCount } from "../db/schema.js";
import {
  generateFactionDisplayName,
  isFactionDisplayName,
} from "../services/factionDisplayName.js";

const FACTION_JOIN_COOKIE = "tlhn_faction_joined";
const FACTION_DISPLAY_NAME_COOKIE = "tlhn_display_name";

export interface FactionsRouterDependencies {
  db: AppDatabase;
}

export function createFactionsRouter(dependencies: FactionsRouterDependencies): Router {
  const router = Router();

  router.get("/counts", async (_req: Request, res: Response, next) => {
    try {
      const counts = await loadFactionCounts(dependencies.db);
      const response: FactionCountsResponse = { counts };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  router.post("/:faction/join", async (req: Request, res: Response, next) => {
    const params = factionJoinParamsSchema.safeParse(req.params);

    if (!params.success) {
      res.status(400).json({
        error: "Invalid faction",
        issues: params.error.flatten().fieldErrors,
      });
      return;
    }

    try {
      const existingJoinedFaction = getJoinedFaction(req);

      if (existingJoinedFaction) {
        const counts = await loadFactionCounts(dependencies.db);
        const displayName = getOrSetDisplayName(req, res, existingJoinedFaction);
        const response: FactionJoinResponse = {
          faction: existingJoinedFaction,
          display_name: displayName,
          counts,
          joined: true,
          already_joined: true,
        };

        res.json(response);
        return;
      }

      await incrementFactionCount(dependencies.db, params.data.faction);
      const counts = await loadFactionCounts(dependencies.db);
      const displayName = generateFactionDisplayName(params.data.faction);
      setSessionCookie(req, res, FACTION_JOIN_COOKIE, params.data.faction);
      setSessionCookie(req, res, FACTION_DISPLAY_NAME_COOKIE, displayName);

      const response: FactionJoinResponse = {
        faction: params.data.faction,
        display_name: displayName,
        counts,
        joined: true,
        already_joined: false,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function loadFactionCounts(db: AppDatabase): Promise<FactionCounts> {
  const rows = await db.select().from(factionCounts);
  return toFactionCounts(rows);
}

async function incrementFactionCount(db: AppDatabase, faction: Faction): Promise<void> {
  await db
    .insert(factionCounts)
    .values({
      faction,
      count: 1,
    })
    .onConflictDoUpdate({
      target: factionCounts.faction,
      set: {
        count: sql`${factionCounts.count} + 1`,
      },
    });
}

function toFactionCounts(rows: FactionCount[]): FactionCounts {
  const counts: FactionCounts = {
    ai_haters: 0,
    ai_lovers: 0,
  };

  for (const row of rows) {
    counts[row.faction] = row.count;
  }

  return counts;
}

function getJoinedFaction(req: Request): Faction | undefined {
  const cookieValue = parseCookies(req.headers.cookie).get(FACTION_JOIN_COOKIE);

  if (cookieValue && isFaction(cookieValue)) {
    return cookieValue;
  }

  return undefined;
}

function getOrSetDisplayName(req: Request, res: Response, faction: Faction): string {
  const cookieValue = parseCookies(req.headers.cookie).get(FACTION_DISPLAY_NAME_COOKIE);

  if (cookieValue && isFactionDisplayName(cookieValue)) {
    return cookieValue;
  }

  const displayName = generateFactionDisplayName(faction);
  setSessionCookie(req, res, FACTION_DISPLAY_NAME_COOKIE, displayName);

  return displayName;
}

function setSessionCookie(
  req: Request,
  res: Response,
  name: string,
  value: string,
): void {
  res.cookie(name, value, {
    httpOnly: true,
    path: "/api/factions",
    sameSite: "lax",
    secure: isHttpsRequest(req),
  });
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    const rawValue = rawValueParts.join("=");

    if (rawName && rawValue) {
      cookies.set(rawName, safeDecodeURIComponent(rawValue));
    }
  }

  return cookies;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isFaction(value: string): value is Faction {
  return FACTIONS.includes(value as Faction);
}

function isHttpsRequest(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}
