import { NextResponse } from "next/server";
import {
  NOTE_GENERATION_SYSTEM_PROMPT,
  buildNoteGenerationUserMessage,
} from "@/lib/note-generation-prompts";
import { openaiChatJsonObject } from "@/lib/openai-chat-json";

export const runtime = "nodejs";

const MAX_MESSAGES = 80;
const FIRST_WINDOW = 15;
const SECOND_WINDOW = 25;

type InMsg = { id: string; role: "user" | "assistant"; content: string };

type BoundaryOut = {
  topic: string;
  start_index: number;
  uncertain: boolean;
  reason: string;
};

type NoteOut = {
  title: string;
  body: string;
};

function parseJsonObject(raw: string): unknown {
  const t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  const inner = fenced ? fenced[1].trim() : t;
  return JSON.parse(inner) as unknown;
}

function asBoundary(o: unknown): BoundaryOut | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.topic !== "string") return null;
  if (typeof r.start_index !== "number" || !Number.isFinite(r.start_index)) {
    return null;
  }
  if (typeof r.uncertain !== "boolean") return null;
  if (typeof r.reason !== "string") return null;
  return {
    topic: r.topic,
    start_index: Math.floor(r.start_index),
    uncertain: r.uncertain,
    reason: r.reason,
  };
}

function asNoteOut(o: unknown): NoteOut | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.title !== "string" || typeof r.body !== "string") return null;
  return { title: r.title.trim(), body: r.body };
}

function formatTranscript(msgs: InMsg[]): string {
  return msgs
    .map(
      (m, i) =>
        `[${i}] id=${m.id} role=${m.role}\n${m.content}`,
    )
    .join("\n\n---\n\n");
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfiguration: OPENAI_API_KEY is not set" },
      { status: 500 },
    );
  }
  const openaiApiKey = apiKey;

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
  const rawMsgs = b.messages;
  const courseName =
    typeof b.courseName === "string" ? b.courseName.trim() : "";
  const sessionName =
    typeof b.sessionName === "string" ? b.sessionName.trim() : "";

  if (!Array.isArray(rawMsgs) || rawMsgs.length === 0) {
    return NextResponse.json(
      { error: 'Expected non-empty "messages" array' },
      { status: 400 },
    );
  }

  const messages: InMsg[] = [];
  for (const m of rawMsgs) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id.trim()) continue;
    if (o.role !== "user" && o.role !== "assistant") continue;
    if (typeof o.content !== "string") continue;
    if (!o.content.trim()) continue;
    messages.push({
      id: o.id.trim(),
      role: o.role,
      content: o.content.slice(0, 24_000),
    });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "No valid messages" }, { status: 400 });
  }

  const tail = messages.slice(-Math.min(MAX_MESSAGES, messages.length));

  const systemBoundary = `You are not summarizing. Your task is to identify the current discussion topic and the earliest message index in THIS window where that topic begins.

Return ONLY a JSON object with keys:
- topic: short description of the current core discussion (same language as the chat is fine)
- start_index: integer index into the numbered window (0-based) where this topic block STARTS
- uncertain: boolean — true if the real topic start is likely BEFORE this window
- reason: one short sentence

Rules:
1. start_index must point to where the CURRENT main thread first appears in this window, not later clarifications.
2. Follow-ups, clarifications, and implementation details about the same core question stay in the SAME topic; do not start a new topic for those.
3. If the user clearly switched to a different question, the topic starts where that new question appears.
4. If the true start is outside this window, set uncertain to true.
5. start_index must be valid: 0 <= start_index < window_length.`;

  async function runBoundary(
    windowMsgs: InMsg[],
  ): Promise<BoundaryOut | null> {
    const user = `Course: ${courseName || "(unknown)"}
Conversation / thread: ${sessionName || "(unknown)"}

Window length: ${windowMsgs.length}

Messages (indices are 0..${windowMsgs.length - 1}):

${formatTranscript(windowMsgs)}

Return JSON only.`;

    const raw = await openaiChatJsonObject({
      apiKey: openaiApiKey,
      system: systemBoundary,
      user,
      temperature: 0.2,
      maxTokens: 1024,
    });
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = parseJsonObject(raw);
    } catch {
      return null;
    }
    return asBoundary(parsed);
  }

  const last15 = tail.length >= FIRST_WINDOW ? tail.slice(-FIRST_WINDOW) : tail;
  const boundary = await runBoundary(last15);

  if (!boundary) {
    return NextResponse.json(
      { error: "Failed to detect topic boundary" },
      { status: 502 },
    );
  }

  let windowUsed: InMsg[];
  let startIdx: number;
  let rangeIncompleteWarning = false;
  let boundaryFinal = boundary;

  if (!boundary.uncertain) {
    windowUsed = last15;
    startIdx = Math.max(
      0,
      Math.min(boundary.start_index, last15.length - 1),
    );
  } else if (tail.length >= SECOND_WINDOW) {
    const last25 = tail.slice(-SECOND_WINDOW);
    const b2 = await runBoundary(last25);
    if (b2 && !b2.uncertain) {
      boundaryFinal = b2;
      windowUsed = last25;
      startIdx = Math.max(0, Math.min(b2.start_index, last25.length - 1));
    } else {
      windowUsed = last25;
      startIdx = 0;
      rangeIncompleteWarning = true;
      if (b2) boundaryFinal = b2;
    }
  } else {
    windowUsed = last15;
    startIdx = 0;
    rangeIncompleteWarning = true;
  }

  const selected = windowUsed.slice(startIdx);
  if (selected.length === 0) {
    return NextResponse.json(
      { error: "No messages in selected range" },
      { status: 400 },
    );
  }

  /** Second LLM call only: discussion-grounded note (boundary detection uses a separate prompt above). */
  const userNote = buildNoteGenerationUserMessage({
    courseName,
    sessionName,
    boundaryTopic: boundaryFinal.topic,
    transcript: formatTranscript(selected),
    messageCount: selected.length,
    rangeIncompleteWarning,
  });

  const noteRaw = await openaiChatJsonObject({
    apiKey: openaiApiKey,
    system: NOTE_GENERATION_SYSTEM_PROMPT,
    user: userNote,
    temperature: 0.35,
    maxTokens: 4096,
  });

  if (!noteRaw) {
    return NextResponse.json(
      { error: "Failed to generate note content" },
      { status: 502 },
    );
  }

  let noteParsed: unknown;
  try {
    noteParsed = parseJsonObject(noteRaw);
  } catch {
    return NextResponse.json(
      { error: "Invalid note JSON from model" },
      { status: 502 },
    );
  }

  const note = asNoteOut(noteParsed);
  if (!note || !note.body.trim()) {
    return NextResponse.json(
      { error: "Empty note from model" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    topic: boundaryFinal.topic,
    startIndex: startIdx,
    windowSize: windowUsed.length,
    uncertain: boundaryFinal.uncertain,
    rangeIncompleteWarning,
    reason: boundaryFinal.reason,
    title: note.title || boundaryFinal.topic || "Note",
    body: note.body,
    messageIds: selected.map((m) => m.id),
  });
}
