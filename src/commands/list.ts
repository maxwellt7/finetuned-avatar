import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";

export interface GenerationEntry {
  prompt: string;
  generated_at: string;
  pngPath: string;
}

export async function runList(
  cfg: Pick<Config, "outputDir">
): Promise<GenerationEntry[]> {
  if (!existsSync(cfg.outputDir)) return [];
  const jsons = readdirSync(cfg.outputDir).filter((f) => f.endsWith(".json"));
  const entries: GenerationEntry[] = jsons.map((f) => {
    const meta = JSON.parse(readFileSync(join(cfg.outputDir, f), "utf8"));
    return {
      prompt: meta.prompt ?? "",
      generated_at: meta.generated_at ?? "",
      pngPath: join(cfg.outputDir, f.replace(/\.json$/, ".png")),
    };
  });
  entries.sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1));
  for (const e of entries) {
    const truncated =
      e.prompt.length > 60 ? `${e.prompt.slice(0, 57)}...` : e.prompt;
    console.log(`${e.generated_at}  ${truncated}  ${e.pngPath}`);
  }
  return entries;
}
