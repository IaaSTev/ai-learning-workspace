export type SyllabusTopic = {
  id: string;
  title: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  followupAnchor?: {
    sourceMessageId: string;
    selectedText: string;
    startOffset: number;
    endOffset: number;
  };
  createdAt: number;
};

export type ChatSession = {
  id: string;
  name: string;
  /** Stable retrieval binding key; do not infer from display name at query time. */
  topicSlug?: string;
  createdAt: number;
  messages: ChatMessage[];
};

/**
 * A topic thread for notes = one chat session (`topicId` === `ChatSession.id`).
 * Card-based notes: many cards per topic, no version dropdown at topic level.
 */
export type NoteCard = {
  id: string;
  topicId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type CourseWorkspace = {
  id: string;
  name: string;
  topics: SyllabusTopic[];
  sessions: ChatSession[];
  createdAt: number;
  /** All note cards in the course; filter by `topicId` for a session/thread. */
  noteCards?: NoteCard[];
};

const STORAGE_KEY = "study-agent-workspace-v1";

function readRaw(): { courses: CourseWorkspace[] } {
  if (typeof window === "undefined") {
    return { courses: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { courses: [] };
    const data = JSON.parse(raw) as { courses?: CourseWorkspace[] };
    return { courses: Array.isArray(data.courses) ? data.courses : [] };
  } catch {
    return { courses: [] };
  }
}

function normalizeNoteCard(raw: unknown): NoteCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string" || !n.id.trim()) return undefined;
  if (typeof n.topicId !== "string" || !n.topicId.trim()) return undefined;
  if (typeof n.title !== "string" || typeof n.content !== "string") {
    return undefined;
  }
  if (typeof n.createdAt !== "number" || typeof n.updatedAt !== "number") {
    return undefined;
  }
  return {
    id: n.id.trim(),
    topicId: n.topicId.trim(),
    title: n.title,
    content: n.content,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

/** Legacy per-session note row (pre–note-cards). */
type LegacySessionNote = {
  id: string;
  title: string;
  body: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  sourceTopic?: string;
};

function normalizeLegacySessionNote(raw: unknown): LegacySessionNote | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string" || !n.id.trim()) return undefined;
  if (typeof n.title !== "string") return undefined;
  const body = typeof n.body === "string" ? n.body : "";
  if (typeof n.version !== "number" || !Number.isFinite(n.version)) return undefined;
  if (typeof n.createdAt !== "number" || typeof n.updatedAt !== "number") {
    return undefined;
  }
  return {
    id: n.id.trim(),
    title: n.title,
    body,
    version: n.version,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    sourceTopic:
      typeof n.sourceTopic === "string" && n.sourceTopic.trim()
        ? n.sourceTopic.trim()
        : undefined,
  };
}

function migrateLegacyNotesToCards(
  /** Raw course from storage; session rows may still include legacy `note` / `notes`. */
  raw: CourseWorkspace,
): NoteCard[] {
  const existing: NoteCard[] = Array.isArray(raw.noteCards)
    ? raw.noteCards
        .map((x) => normalizeNoteCard(x))
        .filter((x): x is NoteCard => Boolean(x))
    : [];
  const byId = new Map(existing.map((c) => [c.id, c]));

  for (const s of raw.sessions) {
    const sess = s as ChatSession & {
      notes?: unknown;
      note?: unknown;
    };
    const arr: LegacySessionNote[] = [];
    if (Array.isArray(sess.notes)) {
      for (const item of sess.notes) {
        const n = normalizeLegacySessionNote(item);
        if (n) arr.push(n);
      }
    }
    const single = normalizeLegacySessionNote(sess.note);
    if (single) arr.push(single);
    for (const n of arr) {
      if (byId.has(n.id)) continue;
      byId.set(n.id, {
        id: n.id,
        topicId: s.id,
        title: n.title,
        content: n.body,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function normalizeCourse(raw: CourseWorkspace): CourseWorkspace {
  const noteCards = migrateLegacyNotesToCards(raw);

  const sessions = raw.sessions.map((s) => {
    const { note: _n, notes: _ns, ...rest } = s as ChatSession & {
      note?: unknown;
      notes?: unknown;
    };
    return {
      ...rest,
      topicSlug:
        typeof rest.topicSlug === "string" && rest.topicSlug.trim()
          ? rest.topicSlug.trim()
          : undefined,
      messages: Array.isArray(rest.messages)
        ? rest.messages.map((m) => ({
            ...m,
            followupAnchor:
              m &&
              typeof m === "object" &&
              "followupAnchor" in m &&
              typeof (m as { followupAnchor?: { sourceMessageId?: unknown } })
                .followupAnchor?.sourceMessageId === "string" &&
              typeof (m as { followupAnchor?: { selectedText?: unknown } })
                .followupAnchor?.selectedText === "string" &&
              typeof (m as { followupAnchor?: { startOffset?: unknown } })
                .followupAnchor?.startOffset === "number" &&
              typeof (m as { followupAnchor?: { endOffset?: unknown } })
                .followupAnchor?.endOffset === "number"
                ? (m as {
                    followupAnchor: {
                      sourceMessageId: string;
                      selectedText: string;
                      startOffset: number;
                      endOffset: number;
                    };
                  }).followupAnchor
                : undefined,
          }))
        : [],
    };
  });

  return {
    ...raw,
    sessions,
    noteCards,
  };
}

function toTopicSlug(label: string): string {
  const t = label.trim().toLowerCase();
  const s = t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "general";
}

export function loadCourses(): CourseWorkspace[] {
  return readRaw().courses.map(normalizeCourse);
}

export function saveCourses(courses: CourseWorkspace[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ courses }));
}

export function getCourse(id: string): CourseWorkspace | undefined {
  return loadCourses().find((c) => c.id === id);
}

export function upsertCourse(course: CourseWorkspace): void {
  const all = loadCourses();
  const i = all.findIndex((c) => c.id === course.id);
  if (i >= 0) {
    all[i] = course;
  } else {
    all.push(course);
  }
  saveCourses(all);
}

/** Remove a course by id. Returns true if a course was removed. */
export function deleteCourse(id: string): boolean {
  const all = loadCourses();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  saveCourses(next);
  return true;
}

export function addSession(
  courseId: string,
  name: string,
  topicSlug?: string,
): ChatSession | null {
  const course = getCourse(courseId);
  if (!course) return null;
  const finalName = name.trim() || "Untitled";
  const finalTopicSlug =
    typeof topicSlug === "string" && topicSlug.trim()
      ? topicSlug.trim()
      : toTopicSlug(finalName);
  const session: ChatSession = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}`,
    name: finalName,
    topicSlug: finalTopicSlug,
    createdAt: Date.now(),
    messages: [],
  };
  upsertCourse({
    ...course,
    sessions: [...course.sessions, session],
  });
  return session;
}

/** Remove one conversation session from a course and its note cards. */
export function deleteSession(courseId: string, sessionId: string): boolean {
  const course = getCourse(courseId);
  if (!course) return false;
  const next = course.sessions.filter((s) => s.id !== sessionId);
  if (next.length === course.sessions.length) return false;
  const cards = (course.noteCards ?? []).filter((c) => c.topicId !== sessionId);
  upsertCourse({ ...course, sessions: next, noteCards: cards });
  return true;
}

/** Append a single chat message to a session (persisted). */
export function appendMessage(
  courseId: string,
  sessionId: string,
  msg: {
    role: "user" | "assistant";
    content: string;
    followupAnchor?: {
      sourceMessageId: string;
      selectedText: string;
      startOffset: number;
      endOffset: number;
    };
  },
): ChatMessage | null {
  const course = getCourse(courseId);
  if (!course) return null;
  const session = course.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const chatMessage: ChatMessage = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}`,
    role: msg.role,
    content: msg.content,
    followupAnchor: msg.followupAnchor,
    createdAt: Date.now(),
  };
  const messages = [...session.messages, chatMessage];
  const sessions = course.sessions.map((s) =>
    s.id === sessionId ? { ...s, messages } : s,
  );
  upsertCourse({ ...course, sessions });
  return chatMessage;
}

/** Merge parsed topic titles into the course (by title, keep first id style). */
export function mergeTopicsFromParse(
  courseId: string,
  newTitles: string[],
): CourseWorkspace | null {
  const course = getCourse(courseId);
  if (!course) return null;
  const seen = new Set(course.topics.map((t) => t.title.toLowerCase().trim()));
  const merged = [...course.topics];
  for (const title of newTitles) {
    const t = title.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `top-${Date.now()}-${merged.length}`,
      title: t,
    });
  }
  const next = { ...course, topics: merged };
  upsertCourse(next);
  return next;
}

export function getNoteCardsForTopic(
  courseId: string,
  topicId: string,
): NoteCard[] {
  const course = getCourse(courseId);
  if (!course) return [];
  return (course.noteCards ?? [])
    .filter((c) => c.topicId === topicId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Add a new note card (e.g. after Generate Note). */
export function addNoteCard(
  courseId: string,
  payload: {
    topicId: string;
    title: string;
    content: string;
  },
): NoteCard | null {
  const course = getCourse(courseId);
  if (!course) return null;
  if (!course.sessions.some((s) => s.id === payload.topicId)) return null;
  const now = Date.now();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `card-${now}`;
  const card: NoteCard = {
    id,
    topicId: payload.topicId,
    title: payload.title.trim() || "Untitled",
    content: payload.content,
    createdAt: now,
    updatedAt: now,
  };
  const noteCards = [...(course.noteCards ?? []), card];
  upsertCourse({ ...course, noteCards });
  return card;
}

export function updateNoteCard(
  courseId: string,
  cardId: string,
  payload: { title: string; content: string },
): NoteCard | null {
  const course = getCourse(courseId);
  if (!course) return null;
  const now = Date.now();
  let out: NoteCard | null = null;
  const noteCards = (course.noteCards ?? []).map((c) => {
    if (c.id !== cardId) return c;
    out = {
      ...c,
      title: payload.title.trim() || "Untitled",
      content: payload.content,
      updatedAt: now,
    };
    return out;
  });
  if (!out) return null;
  upsertCourse({ ...course, noteCards });
  return out;
}

export function deleteNoteCard(courseId: string, cardId: string): boolean {
  const course = getCourse(courseId);
  if (!course) return false;
  const noteCards = (course.noteCards ?? []).filter((c) => c.id !== cardId);
  if (noteCards.length === (course.noteCards ?? []).length) return false;
  upsertCourse({ ...course, noteCards });
  return true;
}
