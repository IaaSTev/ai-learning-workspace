import { memTrace } from "@/lib/mem-trace";

const DEFAULT_MODEL = "text-embedding-3-small";

/** Max texts per embedding API call; lecture ingestion aligns batch size with this. */
export const EMBEDDING_BATCH_SIZE = 16;

export function embeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
}

/** OpenAI embeddings API; batches to avoid huge payloads. */
export async function embedTexts(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  const model = embeddingModel();
  const batchSize = EMBEDDING_BATCH_SIZE;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchIndex = Math.floor(i / batchSize) + 1;
    const batchTotal = Math.ceil(texts.length / batchSize);
    memTrace(
      `embedTexts before embedding API batch ${batchIndex}/${batchTotal} (n=${batch.length})`,
    );
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: batch,
      }),
    });

    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: { message?: string } }).error?.message ===
          "string"
          ? (data as { error: { message: string } }).error.message
          : res.statusText;
      throw new Error(msg || "Embedding request failed");
    }

    const embList =
      data &&
      typeof data === "object" &&
      "data" in data &&
      Array.isArray((data as { data: unknown }).data)
        ? (data as { data: { embedding: number[]; index: number }[] }).data
        : null;

    if (!embList?.length) {
      throw new Error("Empty embedding response");
    }

    embList.sort((a, b) => a.index - b.index);
    for (const row of embList) {
      if (!Array.isArray(row.embedding)) {
        throw new Error("Invalid embedding row");
      }
      out.push(row.embedding);
    }
    memTrace(
      `embedTexts after embedding API batch ${batchIndex}/${batchTotal}`,
    );
  }

  return out;
}

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const [v] = await embedTexts([text], apiKey);
  return v;
}
