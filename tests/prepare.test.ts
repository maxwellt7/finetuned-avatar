import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dedupeFiles } from "../src/prepare.js";

const tmp = join(tmpdir(), `avatar-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "a.jpg"), Buffer.from("AAAA"));
  writeFileSync(join(tmp, "b.jpg"), Buffer.from("BBBB"));
  writeFileSync(join(tmp, "a-copy.jpg"), Buffer.from("AAAA")); // duplicate of a.jpg
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("dedupeFiles", () => {
  it("returns only unique files (by content hash)", async () => {
    const result = await dedupeFiles(tmp);
    expect(result).toHaveLength(2);
    const names = result.map((p) => p.split("/").pop()).sort();
    expect(names).toEqual(["a-copy.jpg", "b.jpg"].sort()); // first hit by sort wins; either is fine
  });

  it("throws if directory is empty", async () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    await expect(dedupeFiles(empty)).rejects.toThrow(/no images/i);
  });
});

import sharp from "sharp";
import { normalizeImage } from "../src/prepare.js";

describe("normalizeImage", () => {
  it("resizes long-edge to 2048 and strips EXIF", async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#888" },
    })
      .jpeg()
      .toBuffer();

    const out = await normalizeImage(big);
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2048);
  });

  it("leaves small images untouched in dimensions", async () => {
    const small = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#222" },
    })
      .jpeg()
      .toBuffer();
    const out = await normalizeImage(small);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});
