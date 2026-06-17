import { randomInt } from "node:crypto";
import type { Faction } from "@tlhn/shared";

const DISPLAY_NAME_SUFFIX_LENGTH = 5;
const DISPLAY_NAME_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const FACTION_PREFIXES: Record<Faction, readonly string[]> = {
  ai_haters: ["luddite", "cassandra", "sentinel", "icarus", "sisyphus", "diogenes"],
  ai_lovers: ["prometheus", "daedalus", "oracle", "tesla", "nova", "cypher"],
};

const DISPLAY_NAME_PATTERN = /^[a-z][a-z0-9]*_[a-z0-9]{5}$/;

export function generateFactionDisplayName(faction: Faction): string {
  const prefixes = FACTION_PREFIXES[faction];
  const prefix = prefixes[randomInt(prefixes.length)];

  return `${prefix}_${generateSuffix(DISPLAY_NAME_SUFFIX_LENGTH)}`;
}

export function isFactionDisplayName(value: string): boolean {
  return DISPLAY_NAME_PATTERN.test(value);
}

function generateSuffix(length: number): string {
  let suffix = "";

  for (let index = 0; index < length; index += 1) {
    suffix +=
      DISPLAY_NAME_SUFFIX_ALPHABET[randomInt(DISPLAY_NAME_SUFFIX_ALPHABET.length)];
  }

  return suffix;
}
