import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { runTrain } from "../../src/commands/train.js";

const tmp = join(tmpdir(), `avatar-train-${Date.now()}`);
const photosDir = join(tmp, "pics");
const cacheFile = join(tmp, "cache", "finetune.json");

beforeEach(async () => {
  mkdirSync(photosDir, { recursive: true });
  const img = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "#777" },
  })
    .jpeg()
    .toBuffer();
  writeFileSync(join(photosDir, "p1.jpg"), img);
  writeFileSync(join(photosDir, "p2.jpg"), img);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ finetune_id: "ft_xyz" }), { status: 200 })
    )
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runTrain", () => {
  it("submits a finetune and writes cache file", async () => {
    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir,
      cacheFile,
      outputDir: join(tmp, "out"),
    };

    const id = await runTrain(cfg);

    expect(id).toBe("ft_xyz");
    expect(existsSync(cacheFile)).toBe(true);
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cached.id).toBe("ft_xyz");
    expect(cached.trigger).toBe("MAXAVATAR");
    expect(cached.status).toBe("Pending");
    expect(cached.photoCount).toBe(1); // p1 and p2 are duplicates
  });
});
