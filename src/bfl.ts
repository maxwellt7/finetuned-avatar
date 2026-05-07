import type { Config } from "./config.js";

export interface FinetunePayload {
  file_data: string;
  finetune_comment: string;
  trigger_word: string;
  mode: "character" | "product" | "style" | "general";
  iterations: number;
  captioning: boolean;
  priority: "quality" | "speed";
  finetune_type: "full" | "lora";
}

async function bflFetch(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  path: string,
  init: RequestInit
): Promise<Response> {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-key": cfg.apiKey,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("BFL auth failed — check your API key.");
  }
  if (res.status === 429) {
    throw new Error("BFL rate-limited (likely a billing issue).");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BFL ${path} returned ${res.status}: ${body}`);
  }
  return res;
}

export async function submitFinetune(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  payload: FinetunePayload
): Promise<string> {
  const res = await bflFetch(cfg, "/finetune", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { finetune_id: string };
  return body.finetune_id;
}
