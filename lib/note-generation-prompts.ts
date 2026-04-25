/**
 * Note generation is separate from boundary detection (see app/api/notes/generate/route.ts).
 * These prompts enforce discussion-grounded notes, not generic topic summaries.
 */

/** System prompt for the second-stage note generator only. */
export const NOTE_GENERATION_SYSTEM_PROMPT = `You are generating study notes from a specific discussion block in a learning conversation.

Your job is not to write a general summary of the topic. Your job is to turn this discussion into focused, editable notes.

Requirements:
1. Only include content that is central to the current discussion block.
2. Do not broaden the note with related topics unless necessary for understanding the main point.
3. Preserve the main question, the explanation given, and the final takeaway reached in the discussion.
4. If the discussion depends on a specific example from the source material (including examples described or quoted inside the assistant/user messages), include that example concretely—keep the same concrete elements (quantities, setup, geometry, steps) rather than replacing them with a generic explanation.
5. Prefer the exact conceptual focus of this discussion over general background knowledge.
6. If the user showed confusion or reached an important clarification, reflect that in the note.
7. Keep the note concise and structured. Use at most 3 to 5 sections (not counting the final Takeaway).

Do not:
- turn the note into a general topic overview or study guide
- add unrelated applications or architectures
- include exam advice unless explicitly discussed
- introduce extra examples not present in the discussion

Output format (required):
Return ONLY a JSON object with exactly two keys:
- "title": a short title that reflects this specific discussion (not a broad course topic name unless the discussion was that broad).
- "body": a single Markdown string. Use ## for section headings, bullets for content. The note must be an editable draft in clear bullet points. End with a short section titled exactly ## Takeaway that states the main conclusion reached in this discussion. Match the language of the discussion when natural.`;

export function buildNoteGenerationUserMessage(params: {
  courseName: string;
  sessionName: string;
  boundaryTopic: string;
  transcript: string;
  messageCount: number;
  rangeIncompleteWarning: boolean;
}): string {
  const warn = params.rangeIncompleteWarning
    ? `Note: The discussion block may be incomplete (the true topic start might be earlier than this window). Stay grounded in the text below only; do not invent earlier turns.\n\n`
    : "";

  return `${warn}The following is the CURRENT DISCUSSION BLOCK: ${params.messageCount} messages (user and assistant), in chronological order. This transcript—including any embedded quotes or paraphrases of readings/slides from the chat—is the ONLY source for the note. Do not pull in outside knowledge except where needed to label what was already said.

Course: ${params.courseName || "(unknown)"}
Conversation / thread: ${params.sessionName || "(unknown)"}
Boundary label (orientation only; do not expand the note beyond the discussion below): ${params.boundaryTopic}

--- Discussion block (verbatim) ---

${params.transcript}

--- End discussion block ---

Return JSON with "title" and "body" as specified in the system message.`;
}
