import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import "dotenv/config";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

export interface Config {
  apiKey: string;
  apiBase: string;
  triggerWord: string;
  photosDir: string;
  cacheFile: string;
  outputDir: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BFL_API_KEY is not set. Add it to ~/avatar/.env (chmod 600)."
    );
  }
  return {
    apiKey,
    apiBase: "https://api.us1.bfl.ai/v1",
    triggerWord: "MAXAVATAR",
    photosDir:
      process.env.PHOTOS_DIR ?? "/Users/maxmayes/Desktop/pics of me",
    cacheFile: join(projectRoot, "cache", "finetune.json"),
    outputDir: join(projectRoot, "output"),
  };
}
