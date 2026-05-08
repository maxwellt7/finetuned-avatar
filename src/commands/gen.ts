import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { Config } from "../config.js";
import {
  generate,
  getRequestStatus,
  getTrainResult,
  type GeneratePayload,
} from "../fal.js";

export interface GenOptions {
  count: number;
  aspectRatio: string;
  strength: number;
  open: boolean;
  pollIntervalMs?: number;
}

const ASPECT_TO_FAL_SIZE: Record<string, GeneratePayload["image_size"]> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
};

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

  if (!cached.loraUrl) {
    const live = await getRequestStatus(cfg, cached.statusUrl);
    if (live.status !== "COMPLETED") {
      throw new Error(
        `Avatar still training (state: ${live.status}). Try again later.`
      );
    }
    const result = await getTrainResult(cfg, cached.responseUrl);
    cached.status = "COMPLETED";
    cached.loraUrl = result.diffusers_lora_file.url;
    if (result.config_file?.url) cached.configUrl = result.config_file.url;
    writeFileSync(cfg.cacheFile, JSON.stringify(cached, null, 2));
  }

  if (!prompt.includes(cfg.triggerWord)) {
    console.warn(
      `Warning: prompt does not include "${cfg.triggerWord}" — output may not look like you.`
    );
  }

  const imageSize = ASPECT_TO_FAL_SIZE[opts.aspectRatio];
  if (!imageSize) {
    throw new Error(
      `Unsupported aspect ratio "${opts.aspectRatio}". Use one of: ${Object.keys(ASPECT_TO_FAL_SIZE).join(", ")}.`
    );
  }

  mkdirSync(cfg.outputDir, { recursive: true });

  const submissions = await generate(
    cfg,
    {
      prompt,
      loras: [{ path: cached.loraUrl, scale: opts.strength }],
      image_size: imageSize,
      num_images: opts.count,
      num_inference_steps: 50,
      guidance_scale: 3.5,
      output_format: "png",
      enable_safety_checker: false,
    },
    { pollIntervalMs: opts.pollIntervalMs }
  );

  const slug = slugify(prompt);
  const paths: string[] = [];
  for (let i = 0; i < submissions.length; i++) {
    const r = submissions[i];
    const ts = tsForFile();
    const suffix = submissions.length > 1 ? `-${i + 1}` : "";
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
          lora_url: cached.loraUrl,
          lora_scale: opts.strength,
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
