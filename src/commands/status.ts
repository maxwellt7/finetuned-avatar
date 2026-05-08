import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Config } from "../config.js";
import {
  getRequestStatus,
  getTrainResult,
  type RequestStatus,
} from "../fal.js";

export async function runStatus(cfg: Config): Promise<RequestStatus> {
  if (!existsSync(cfg.cacheFile)) {
    throw new Error("No finetune yet. Run `avatar train` first.");
  }
  const cached = JSON.parse(readFileSync(cfg.cacheFile, "utf8"));
  const live = await getRequestStatus(cfg, cached.statusUrl);
  console.log(`Training ${cached.id}: ${live.status}${live.queue_position !== undefined ? ` (queue position ${live.queue_position})` : ""}`);

  let mutated = false;
  if (cached.status !== live.status) {
    cached.status = live.status;
    mutated = true;
  }

  if (live.status === "COMPLETED" && !cached.loraUrl) {
    const result = await getTrainResult(cfg, cached.responseUrl);
    cached.loraUrl = result.diffusers_lora_file.url;
    if (result.config_file?.url) cached.configUrl = result.config_file.url;
    console.log(`LoRA ready: ${cached.loraUrl}`);
    mutated = true;
  }

  if (mutated) {
    writeFileSync(cfg.cacheFile, JSON.stringify(cached, null, 2));
  }
  return live.status;
}
