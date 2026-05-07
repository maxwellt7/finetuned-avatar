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

export type FinetuneStatus =
  | "Pending"
  | "Ready"
  | "Error"
  | "Content Moderated"
  | "Task not found";

export interface BflResult {
  status: FinetuneStatus;
  result?: { sample?: string };
}

export async function getResult(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  id: string
): Promise<BflResult> {
  const res = await bflFetch(cfg, `/get_result?id=${encodeURIComponent(id)}`, {
    method: "GET",
  });
  return (await res.json()) as BflResult;
}

export interface GeneratePayload {
  finetune_id: string;
  finetune_strength: number;
  prompt: string;
  aspect_ratio: string;
  safety_tolerance: number;
  output_format: "png" | "jpeg";
}

export interface GenerateOptions {
  pollIntervalMs?: number;
  maxAttempts?: number;
}

export interface GenerateResult {
  imageUrl: string;
  taskId: string;
}

export async function generate(
  cfg: Pick<Config, "apiKey" | "apiBase">,
  payload: GeneratePayload,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const maxAttempts = opts.maxAttempts ?? 80;

  const submitRes = await bflFetch(cfg, "/flux-pro-1.1-ultra-finetuned", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const submitBody = (await submitRes.json()) as {
    id: string;
    polling_url: string;
  };

  for (let i = 0; i < maxAttempts; i++) {
    const pollRes = await fetch(submitBody.polling_url, {
      headers: { "x-key": cfg.apiKey },
    });
    if (!pollRes.ok) {
      throw new Error(`Poll failed: ${pollRes.status}`);
    }
    const pollBody = (await pollRes.json()) as BflResult;
    if (pollBody.status === "Ready") {
      const url = pollBody.result?.sample;
      if (!url) throw new Error("Ready but no image URL returned.");
      return { imageUrl: url, taskId: submitBody.id };
    }
    if (pollBody.status === "Content Moderated") {
      throw new Error(
        "Generation was content-moderated. Try rephrasing the prompt."
      );
    }
    if (pollBody.status === "Error" || pollBody.status === "Task not found") {
      throw new Error(`Generation failed: ${pollBody.status}`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    "Generation timed out — check `avatar list` later or retry."
  );
}
