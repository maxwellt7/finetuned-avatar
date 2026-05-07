import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Config } from "../config.js";
import { getResult, type FinetuneStatus } from "../bfl.js";

export async function runStatus(cfg: Config): Promise<FinetuneStatus> {
  if (!existsSync(cfg.cacheFile)) {
    throw new Error("No finetune yet. Run `avatar train` first.");
  }
  const cached = JSON.parse(readFileSync(cfg.cacheFile, "utf8"));
  const live = await getResult(cfg, cached.id);
  console.log(`Finetune ${cached.id}: ${live.status}`);
  if (cached.status !== live.status) {
    cached.status = live.status;
    writeFileSync(cfg.cacheFile, JSON.stringify(cached, null, 2));
  }
  return live.status;
}
