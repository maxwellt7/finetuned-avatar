import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runStatus } from "../../src/commands/status.js";

const tmp = join(tmpdir(), `avatar-status-${Date.now()}`);
const cacheFile = join(tmp, "cache", "finetune.json");

beforeEach(() => {
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(
    cacheFile,
    JSON.stringify({ id: "ft_a", trigger: "MAXAVATAR", status: "Pending" })
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runStatus", () => {
  it("prints status from BFL and updates cache when Ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "Ready" }), { status: 200 })
      )
    );

    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir: "",
    };

    const status = await runStatus(cfg);
    expect(status).toBe("Ready");
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    expect(cached.status).toBe("Ready");
  });

  it("throws if cache file missing", async () => {
    rmSync(cacheFile);
    const cfg = {
      apiKey: "k",
      apiBase: "https://api.test/v1",
      triggerWord: "MAXAVATAR",
      photosDir: "",
      cacheFile,
      outputDir: "",
    };
    await expect(runStatus(cfg)).rejects.toThrow(/avatar train/);
  });
});
