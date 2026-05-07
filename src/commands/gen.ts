import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import { generate, getResult } from "../bfl.js";

export interface GenOptions {
  count: number;
  aspectRatio: string;
  strength: number;
  open: boolean;
  pollIntervalMs?: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .slice(0, 60) || "untitled";
}

function tsForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

export async function runGen(
  cfg: Config,
  prompt: string,
  opts: GenOptions
): Promise<string[]> {
  if (opts.count > 4) {
    throw new Error("Max 4 images per call. Re-run for more.");
  }
  if (!existsSync(cfg.cacheFile)) {
    throw new Error("Run `avatar train` first.");
  }
  const cached = JSON.parse(readFileSync(cfg.cacheFile, "utf8"));

  if (cached.status !== "Ready") {
    const live = await getResult(cfg, cached.id);
    if (live.status !== "Ready") {
      throw new Error(
        `Avatar still training (state: ${live.status}). Try again later.`
      );
    }
    cached.status = "Ready";
    writeFileSync(cfg.cacheFile, JSON.stringify(cached, null, 2));
  }

  if (!prompt.includes(cfg.triggerWord)) {
    console.warn(
      `Warning: prompt does not include "${cfg.triggerWord}" — output may not look like you.`
    );
  }

  mkdirSync(cfg.outputDir, { recursive: true });
  const tasks = Array.from({ length: opts.count }, () =>
    generate(
      cfg,
      {
        finetune_id: cached.id,
        finetune_strength: opts.strength,
        prompt,
        aspect_ratio: opts.aspectRatio,
        safety_tolerance: 2,
        output_format: "png",
      },
      { pollIntervalMs: opts.pollIntervalMs }
    )
  );
  const results = await Promise.all(tasks);

  const slug = slugify(prompt);
  const paths: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ts = tsForFile();
    const suffix = results.length > 1 ? `-${i + 1}` : "";
    const pngPath = join(cfg.outputDir, `${ts}-${slug}${suffix}.png`);
    const jsonPath = join(cfg.outputDir, `${ts}-${slug}${suffix}.json`);
    const imgRes = await fetch(r.imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Image download failed: ${imgRes.status}`);
    }
    writeFileSync(pngPath, Buffer.from(await imgRes.arrayBuffer()));
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          prompt,
          finetune_id: cached.id,
          finetune_strength: opts.strength,
          aspect_ratio: opts.aspectRatio,
          request_id: r.taskId,
          generated_at: new Date().toISOString(),
        },
        null,
        2
      )
    );
    console.log(`Saved: ${pngPath}`);
    paths.push(pngPath);
    if (opts.open && process.platform === "darwin") {
      execFile("open", [pngPath]);
    }
  }
  return paths;
}
