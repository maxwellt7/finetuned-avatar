import { readdirSync, readFileSync } from "node:fs";
import archiver from "archiver";
import { basename } from "node:path";
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

import sharp from "sharp";

export async function normalizeImage(buf: Buffer): Promise<Buffer> {
  const img = sharp(buf, { failOn: "none" }).rotate(); // honor + drop orientation EXIF
  const meta = await img.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const pipeline = longEdge > 2048 ? img.resize({ width: 2048, height: 2048, fit: "inside" }) : img;
  return pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

export interface TrainingZip {
  base64: string;
  uniqueCount: number;
  totalCount: number;
}

export async function buildTrainingZip(dir: string): Promise<TrainingZip> {
  const all = readdirSync(dir).filter((f) =>
    IMAGE_EXTS.has(extname(f).toLowerCase())
  );
  const unique = await dedupeFiles(dir);

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c) => chunks.push(c));

  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });

  for (const path of unique) {
    const raw = readFileSync(path);
    const normalized = await normalizeImage(raw);
    archive.append(normalized, { name: basename(path).replace(/\.[^.]+$/, ".jpg") });
  }
  await archive.finalize();
  await done;

  const buf = Buffer.concat(chunks);
  return {
    base64: buf.toString("base64"),
    uniqueCount: unique.length,
    totalCount: all.length,
  };
}
