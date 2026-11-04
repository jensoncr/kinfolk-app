import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultSoulPath = resolve(process.cwd(), "lib/text-agent/soul.md");
let cachedSoul: string | null = null;

export function loadSoul() {
  if (cachedSoul !== null) {
    return cachedSoul;
  }

  const soulPath = process.env.KINFOLK_SOUL_PATH
    ? resolve(process.env.KINFOLK_SOUL_PATH)
    : defaultSoulPath;

  cachedSoul = readFileSync(soulPath, "utf8").trim();
  return cachedSoul;
}
