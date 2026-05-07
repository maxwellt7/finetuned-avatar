import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BFL_API_KEY;
    delete process.env.PHOTOS_DIR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when BFL_API_KEY is missing", () => {
    expect(() => loadConfig()).toThrow(/BFL_API_KEY/);
  });

  it("returns config with defaults when env is set", () => {
    process.env.BFL_API_KEY = "test-key";
    const cfg = loadConfig();
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.triggerWord).toBe("MAXAVATAR");
    expect(cfg.apiBase).toBe("https://api.bfl.ai/v1");
    expect(cfg.photosDir).toContain("pics of me");
    expect(cfg.cacheFile).toMatch(/cache\/finetune\.json$/);
    expect(cfg.outputDir).toMatch(/output$/);
  });

  it("uses PHOTOS_DIR override if set", () => {
    process.env.BFL_API_KEY = "test-key";
    process.env.PHOTOS_DIR = "/tmp/custom";
    const cfg = loadConfig();
    expect(cfg.photosDir).toBe("/tmp/custom");
  });
});
