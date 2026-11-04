import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type CardFont = {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
};

const FONT_DIR = join(process.cwd(), "assets", "og-fonts");

// Loaded once per server process; the og cards reuse the same brand faces
// (Fraunces for display lines, Inter for body) so they match the app's type.
let cached: Promise<CardFont[]> | null = null;

export function loadCardFonts(): Promise<CardFont[]> {
  if (!cached) {
    cached = Promise.all([
      readFile(join(FONT_DIR, "Inter-Regular.ttf")),
      readFile(join(FONT_DIR, "Inter-Bold.ttf")),
      readFile(join(FONT_DIR, "Fraunces-SemiBold.ttf")),
    ]).then(([interRegular, interBold, fraunces]) => [
      { name: "Inter", data: interRegular, weight: 400, style: "normal" },
      { name: "Inter", data: interBold, weight: 700, style: "normal" },
      { name: "Fraunces", data: fraunces, weight: 600, style: "normal" },
    ]);
  }
  return cached;
}
