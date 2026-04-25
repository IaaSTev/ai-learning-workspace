import { openaiModel } from "@/lib/course-extraction";

/**
 * Chat completion with JSON object response. For small structured outputs (notes, boundaries).
 */
export async function openaiChatJsonObject(params: {
  apiKey: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel(),
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });

  const json: unknown = await res.json();
  if (!res.ok) {
    console.error("[openai-chat-json] OpenAI error:", json);
    return null;
  }
  if (
    typeof json === "object" &&
    json !== null &&
    "choices" in json &&
    Array.isArray((json as { choices: unknown }).choices)
  ) {
    const c = (json as { choices: { message?: { content?: string } }[] })
      .choices[0]?.message?.content;
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}
