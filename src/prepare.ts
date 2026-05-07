import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);

export async function dedupeFiles(dir: string): Promise<string[]> {
  const all = readdirSync(dir)
    .filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .sort();

  if (all.length === 0) {
    throw new Error(`No images found in ${dir}`);
  }

  const seen = new Map<string, string>();
  for (const path of all) {
    const hash = createHash("sha1").update(readFileSync(path)).digest("hex");
    if (!seen.has(hash)) seen.set(hash, path);
  }
  return Array.from(seen.values());
}
