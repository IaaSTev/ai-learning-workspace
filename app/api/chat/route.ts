import { NextResponse } from "next/server";
import { memTrace } from "@/lib/mem-trace";
import {
  documentFirstModeSystemRules,
  isDocumentFirstQuery,
} from "@/lib/document-first-chat";
import { openaiModel } from "@/lib/course-extraction";
import { retrieveForQuery } from "@/lib/rag/retrieve";

export const runtime = "nodejs";

const MAX_MESSAGES = 80;
const MAX_CONTENT_CHARS = 12_000;

type Role = "user" | "assistant";

type HighlightFollowupPayload = {
  type: "highlight_followup";
  sourceMessageId: string;
  highlight: {
    text: string;
    startOffset: number;
    endOffset: number;
  };
  userQuestion: string;
  context: {
    originalUserQuestion: string;
    assistantMessage: string;
  };
};

function parseHighlightFollowup(raw: unknown): HighlightFollowupPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.type !== "highlight_followup") return null;
  if (typeof o.sourceMessageId !== "string" || !o.sourceMessageId.trim()) {
    return null;
  }
  if (!o.highlight || typeof o.highlight !== "object") return null;
  if (!o.context || typeof o.context !== "object") return null;
  const h = o.highlight as Record<string, unknown>;
  const c = o.context as Record<string, unknown>;
  if (typeof h.text !== "string" || !h.text.trim()) return null;
  if (typeof h.startOffset !== "number" || typeof h.endOffset !== "number") {
    return null;
  }
  if (
    typeof c.originalUserQuestion !== "string" ||
    typeof c.assistantMessage !== "string"
  ) {
    return null;
  }
  if (typeof o.userQuestion !== "string" || !o.userQuestion.trim()) return null;
  return {
    type: "highlight_followup",
    sourceMessageId: o.sourceMessageId.trim(),
    highlight: {
      text: h.text,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
    },
    userQuestion: o.userQuestion,
    context: {
      originalUserQuestion: c.originalUserQuestion,
      assistantMessage: c.assistantMessage,
    },
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const rawMessages = b.messages;
  if (!Array.isArray(rawMessages)) {
    return NextResponse.json({ error: 'Expected "messages" array' }, { status: 400 });
  }

  const courseName =
    typeof b.courseName === "string" ? b.courseName.trim() : "";
  const sessionTopic =
    typeof b.sessionTopic === "string" ? b.sessionTopic.trim() : "";
  const sessionTopicSlug =
    typeof b.sessionTopicSlug === "string" ? b.sessionTopicSlug.trim() : "";
  const courseId =
    typeof b.courseId === "string" ? b.courseId.trim() : "";
  const highlightFollowup = parseHighlightFollowup(b.highlightFollowup);

  const messages: { role: Role; content: string }[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (o.role !== "user" && o.role !== "assistant") continue;
    if (typeof o.content !== "string") continue;
    const content = o.content.slice(0, MAX_CONTENT_CHARS);
    if (!content.trim()) continue;
    messages.push({ role: o.role, content });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "No valid messages" }, { status: 400 });
  }

  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: "Too many messages in this request" },
      { status: 400 },
    );
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from the user" },
      { status: 400 },
    );
  }

  memTrace("api/chat POST handler START");
  try {
  const documentFirst = isDocumentFirstQuery(last.content);
  console.log("[chat-api] request session context", {
    courseId: courseId || "(empty)",
    sessionTopic: sessionTopic || "(empty)",
    sessionTopicSlug: sessionTopicSlug || "(empty)",
    highlightFollowup: highlightFollowup
      ? {
          sourceMessageId: highlightFollowup.sourceMessageId,
          selectedTextPreview: highlightFollowup.highlight.text.slice(0, 120),
          startOffset: highlightFollowup.highlight.startOffset,
          endOffset: highlightFollowup.highlight.endOffset,
        }
      : null,
    userQuestion: last.content.slice(0, 200),
  });

  let system = `You are a helpful study assistant for university courses. Explain concepts clearly, step by step when useful, and relate answers to how they typically show up in coursework or exams. If the question is off-topic, answer briefly and redirect to the course.`;
  if (courseName) {
    system += ` The student is enrolled in: ${courseName}.`;
  }
  if (sessionTopic) {
    system += ` This chat thread is labeled "${sessionTopic}"—use it as the primary theme when relevant.`;
  }
  if (highlightFollowup) {
    system += `

--- Highlight follow-up context ---
The user is asking a focused follow-up about a highlighted span from a prior assistant reply.
Answer primarily about the highlighted span in its original context.
Do not re-explain the whole topic unless needed to resolve the follow-up.
If the highlighted span is ambiguous or slightly inaccurate, say so directly.

Source assistant message:
${highlightFollowup.context.assistantMessage}

Original user question for that turn:
${highlightFollowup.context.originalUserQuestion || "(not available)"}

Highlighted span:
${highlightFollowup.highlight.text}
--- End highlight follow-up context ---
`;
  }

  if (courseId) {
    try {
      console.log("[chat-api] retrieval inputs", {
        courseId,
        sessionTopic: sessionTopic || "(empty)",
        sessionTopicSlug: sessionTopicSlug || "(empty)",
      });
      memTrace("api/chat before retrieveForQuery");
      const { contextBlock } = await retrieveForQuery({
        apiKey,
        courseId,
        query: last.content,
        sessionTopic,
        sessionTopicSlug,
        topK: 8,
      });
      memTrace("api/chat after retrieveForQuery");
      console.log("[chat-api] retrieval outputs", {
        courseId,
        sessionTopic: sessionTopic || "(empty)",
        sessionTopicSlug: sessionTopicSlug || "(empty)",
        contextBlockLength: contextBlock.length,
      });
      if (contextBlock) {
        system += `

--- Retrieved materials for this course (priority: lecture notes > note summaries > textbook > syllabus structure). ---
Use the retrieved passages as primary evidence. If something is not covered, say so.

RAG answering principles:
- Be document-grounded: base claims on retrieved evidence.
- Prefer extraction over free rewriting for list/enumeration questions.
- For numeric/factual questions, preserve exact values and calculations when present.
- Distinguish explicit document content from related background knowledge.
- Stay concise and avoid unsupported claims.

Few-shot examples:

[Example 1: Enumeration / extraction]
User question:
In this lecture, what are the three alternative approaches to learning representations besides neural networks?

Retrieved evidence:
- How to Learn a Representation? Support Vector Machine (SVM)
- How to Learn a Representation? Decision Trees
- How to Learn a Representation? Ensemble Methods
- Next section: Neural Networks

Good answer:
According to this lecture, the three alternative approaches besides neural networks are:
1. Support Vector Machines (SVMs)
2. Decision Trees
3. Ensemble Methods

Bad answer:
The lecture mentions decision trees, ensemble methods, and nonlinear linear models.

Why bad:
Because it replaces a retrieved item (SVM) with a related but different concept.

[Example 2: Numerical / factual]
User question:
What is the generalization gap in this lecture's random train/test split example, and how does the lecture interpret it?

Retrieved evidence:
- train RMSE = 3.70
- test RMSE = 4.39
- generalization gap = 4.39 - 3.70 = 0.69
- 18% difference
- evidence of moderate overfitting

Good answer:
In this lecture, the generalization gap is 0.69, computed from a training RMSE of 3.70 and a test RMSE of 4.39. The lecture interprets this as evidence of moderate overfitting.

Bad answer:
The generalization gap is small, which means the model generalizes well.

Why bad:
Because it ignores the specific numerical evidence and contradicts the lecture's interpretation.

[Example 3: Document boundary]
User question:
Does this lecture explicitly mention ridge regression?

Retrieved evidence:
- Regularized Linear Regression: Weight Shrinkage
- MSE + λ w^T w
- L2 regularization / weight shrinkage
- No explicit occurrence of the phrase "ridge regression"

Good answer:
This lecture does not explicitly mention ridge regression by name. It does discuss weight shrinkage / L2 regularization, including an objective of the form MSE + λ w^T w.

Bad answer:
Yes, this lecture explains ridge regression in detail.

Why bad:
Because it turns related document content into an explicit claim that the lecture does not actually make.

Now answer the current user question using the same principles:
- be document-grounded
- prefer extraction over free rewriting for list questions
- distinguish explicit document content from extra background knowledge
- stay concise

Retrieved evidence:
${contextBlock}`;
      }
    } catch (ragErr) {
      memTrace("api/chat after retrieveForQuery (error path, continuing)");
      console.warn("[chat] RAG retrieve failed:", ragErr);
    }
  } else {
    memTrace("api/chat skip retrieveForQuery (no courseId)");
  }

  if (documentFirst) {
    system += documentFirstModeSystemRules();
  }

  try {
    memTrace("api/chat before OpenAI chat completions");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiModel(),
        messages: [{ role: "system", content: system }, ...messages],
        temperature: 0.6,
        max_tokens: 2048,
      }),
    });

    const data: unknown = await res.json().catch(() => null);
    memTrace("api/chat after OpenAI chat completions response body");

    if (!res.ok) {
      const errMsg =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error?: { message?: string } }).error?.message ===
          "string"
          ? (data as { error: { message: string } }).error.message
          : res.statusText;
      console.error("[chat] OpenAI error:", res.status, errMsg);
      return NextResponse.json(
        { error: errMsg || "OpenAI request failed" },
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      );
    }

    const choice =
      data &&
      typeof data === "object" &&
      "choices" in data &&
      Array.isArray((data as { choices: unknown }).choices)
        ? (data as { choices: { message?: { content?: string } }[] }).choices[0]
        : undefined;

    const reply =
      typeof choice?.message?.content === "string"
        ? choice.message.content
        : null;

    if (reply == null || !reply.trim()) {
      return NextResponse.json(
        { error: "Empty model response" },
        { status: 502 },
      );
    }

    return NextResponse.json({ reply: reply.trim() });
  } catch (err) {
    console.error("[chat] Failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Request failed" },
      { status: 500 },
    );
  }
  } finally {
    memTrace("api/chat POST handler END");
  }
}
