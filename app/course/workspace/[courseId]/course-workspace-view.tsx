"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  ChatSession,
  CourseWorkspace,
  NoteCard,
} from "@/lib/workspace-storage";
import { memTrace } from "@/lib/mem-trace";
import {
  addNoteCard,
  addSession,
  appendMessage,
  deleteCourse,
  deleteNoteCard,
  deleteSession,
  getCourse,
  getNoteCardsForTopic,
  loadCourses,
  updateNoteCard,
} from "@/lib/workspace-storage";

function BookIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <path d="M8 7h8M8 11h8" />
    </svg>
  );
}

function NoteDocIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({
  className,
  direction,
}: {
  className?: string;
  direction: "up" | "down";
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      {direction === "up" ? (
        <path d="M18 15l-6-6-6 6" />
      ) : (
        <path d="M6 9l6 6 6-6" />
      )}
    </svg>
  );
}

function formatNoteCardCreatedAt(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function NoteCardHeader({
  title,
  createdAt,
  expanded,
  onToggleExpand,
}: {
  title: string;
  createdAt: number;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggleExpand}
      className="flex w-full items-start justify-between gap-3 rounded-md text-left outline-none hover:bg-black/[0.02] focus-visible:ring-2 focus-visible:ring-black/20"
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse note" : "Expand note"}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug text-black">{title}</p>
        <p className="mt-1 text-[11px] text-[#9a9a9a]">
          Created {formatNoteCardCreatedAt(createdAt)}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] font-medium text-[#6b6b6b]">
        <span>{expanded ? "Collapse" : "Expand"}</span>
        <ChevronIcon
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          direction="down"
        />
      </span>
    </button>
  );
}

function NoteCardPreview({ content }: { content: string }) {
  return (
    <p className="mt-2 line-clamp-3 break-words whitespace-pre-wrap text-sm leading-snug text-[#4a4a4a]">
      {content}
    </p>
  );
}

function NoteCardBody({ content }: { content: string }) {
  return (
    <div className="mt-3 border-t border-[#ececec] pt-3">
      <pre className="max-h-[min(55vh,420px)] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#2a2a2a]">
        {content}
      </pre>
    </div>
  );
}

type SelectionCandidate = {
  sourceMessageId: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
};

type ActiveFollowupAnchor = {
  sourceMessageId: string;
  selectedText: string;
  startOffset: number;
  endOffset: number;
};

function normalizeSelectionText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function renderAssistantWithHighlight(
  content: string,
  activeAnchor: ActiveFollowupAnchor | null,
  persistedAnchors: ActiveFollowupAnchor[],
  messageId: string,
): React.ReactNode {
  const ranges: { start: number; end: number }[] = [];
  for (const a of persistedAnchors) {
    if (a.sourceMessageId !== messageId) continue;
    const start = Math.max(0, Math.min(a.startOffset, content.length));
    const end = Math.max(start, Math.min(a.endOffset, content.length));
    if (start < end) ranges.push({ start, end });
  }
  if (activeAnchor && activeAnchor.sourceMessageId === messageId) {
    const start = Math.max(0, Math.min(activeAnchor.startOffset, content.length));
    const end = Math.max(start, Math.min(activeAnchor.endOffset, content.length));
    if (start < end) ranges.push({ start, end });
  }
  if (ranges.length === 0) {
    return content;
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (!prev || r.start > prev.end) {
      merged.push({ start: r.start, end: r.end });
    } else if (r.end > prev.end) {
      prev.end = r.end;
    }
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    if (cursor < r.start) {
      out.push(content.slice(cursor, r.start));
    }
    out.push(
      <mark key={`hl-${messageId}-${r.start}-${r.end}-${i}`} className="rounded-sm bg-yellow-300/70 px-0.5">
        {content.slice(r.start, r.end)}
      </mark>,
    );
    cursor = r.end;
  }
  if (cursor < content.length) {
    out.push(content.slice(cursor));
  }
  return (
    <>
      {out}
    </>
  );
}

export function CourseWorkspaceView() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;

  const [ready, setReady] = useState(false);
  const [courses, setCourses] = useState<CourseWorkspace[]>([]);
  const [course, setCourse] = useState<CourseWorkspace | null>(null);
  const [search, setSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [newConvName, setNewConvName] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [courseMenu, setCourseMenu] = useState<{
    courseId: string;
    x: number;
    y: number;
  } | null>(null);
  const courseMenuRef = useRef<HTMLDivElement>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const [selectionCandidate, setSelectionCandidate] =
    useState<SelectionCandidate | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<ActiveFollowupAnchor | null>(
    null,
  );
  const [noteGenerating, setNoteGenerating] = useState(false);
  /** Single-card dialog: view (read-only) or edit. */
  const [noteDialog, setNoteDialog] = useState<
    | null
    | { mode: "view" | "edit"; card: NoteCard }
  >(null);
  const [draftNoteTitle, setDraftNoteTitle] = useState("");
  const [draftNoteContent, setDraftNoteContent] = useState("");
  /** Multi-open: multiple cards may be expanded at once (simpler toggle logic). */
  const [expandedNoteIds, setExpandedNoteIds] = useState<string[]>([]);
  /**
   * Level 1: entire Notes panel for this conversation (topic). Collapsed by default
   * so chat stays readable; expand to see this topic’s note cards.
   */
  const [topicNotesExpanded, setTopicNotesExpanded] = useState(false);

  useEffect(() => {
    memTrace(
      `course/workspace CourseWorkspaceView useEffect init START [courseId=${courseId}]`,
    );
    try {
      const list = loadCourses();
      setCourses(list);
      const c = getCourse(courseId);
      setCourse(c ?? null);
      setSelectedSessionId(null);
      setReady(true);
    } finally {
      memTrace(
        `course/workspace CourseWorkspaceView useEffect init END [courseId=${courseId}]`,
      );
    }
    if (
      typeof performance !== "undefined" &&
      performance &&
      "memory" in performance
    ) {
      const pm = (
        performance as Performance & {
          memory?: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
          };
        }
      ).memory;
      if (pm) {
        console.log("[mem-browser] CourseWorkspaceView after init", {
          heapUsed: pm.usedJSHeapSize,
          heapTotal: pm.totalJSHeapSize,
          rss: "N/A (browser)",
        });
      }
    }
  }, [courseId]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!courseMenu) return;
    function onPointerDown(e: PointerEvent) {
      if (courseMenuRef.current?.contains(e.target as Node)) return;
      setCourseMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCourseMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [courseMenu]);

  useEffect(() => {
    if (!sessionMenu) return;
    function onPointerDown(e: PointerEvent) {
      if (sessionMenuRef.current?.contains(e.target as Node)) return;
      setSessionMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSessionMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [sessionMenu]);

  useEffect(() => {
    if (!course) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [course, selectedSessionId, chatSending]);

  useEffect(() => {
    setSelectionCandidate(null);
    setActiveAnchor(null);
    setNoteDialog(null);
  }, [selectedSessionId]);

  useEffect(() => {
    setExpandedNoteIds([]);
    setTopicNotesExpanded(false);
  }, [selectedSessionId]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    function onScroll() {
      setSelectionCandidate(null);
    }
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const filteredCourses = courses.filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const topicNoteCards = useMemo(() => {
    if (!selectedSessionId) return [];
    return getNoteCardsForTopic(courseId, selectedSessionId);
  }, [courseId, selectedSessionId, course?.noteCards]);

  async function onUploadMaterial(f: File | null) {
    if (!f || !f.name.toLowerCase().endsWith(".pdf")) return;
    setUploadBusy(true);
    setPlusOpen(false);
    try {
      const selectedSession =
        selectedSessionId != null
          ? course?.sessions.find((s) => s.id === selectedSessionId)
          : undefined;
      const topicLabel = selectedSession?.name || course?.topics[0]?.title || "General";
      const topicSlug =
        selectedSession?.topicSlug ||
        topicLabel
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "") ||
        "general";
      console.log("[chat-ui] upload topic binding", {
        courseId,
        selectedSessionId: selectedSession?.id ?? null,
        topicLabel,
        topicSlug,
      });
      const fd = new FormData();
      fd.append("file", f);
      fd.append("courseId", courseId);
      fd.append("topic", topicLabel);
      fd.append("topicSlug", topicSlug);
      const res = await fetch("/api/rag/ingest-lecture", {
        method: "POST",
        body: fd,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: string }).error === "string"
            ? (data as { error: string }).error
            : "Ingest failed";
        alert(msg);
        return;
      }
      const count =
        typeof data === "object" &&
        data !== null &&
        "chunkCount" in data &&
        typeof (data as { chunkCount: unknown }).chunkCount === "number"
          ? (data as { chunkCount: number }).chunkCount
          : 0;
      const truncated =
        typeof data === "object" &&
        data !== null &&
        "truncated" in data &&
        (data as { truncated: unknown }).truncated === true;
      alert(
        `Indexed ${count} passage(s) for topic “${topicLabel}”.` +
          (truncated
            ? " (Large file: only the first portion was indexed to protect memory.)"
            : ""),
      );
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleDeleteCourseFromMenu(targetId: string) {
    setCourseMenu(null);
    if (
      !confirm(
        "Delete this course and all its conversations? This cannot be undone.",
      )
    ) {
      return;
    }
    deleteCourse(targetId);
    const nextList = loadCourses();
    setCourses(nextList);
    if (targetId === courseId) {
      if (nextList.length > 0) {
        router.push(`/course/workspace/${nextList[0].id}`);
      } else {
        router.push("/course/create");
      }
    }
  }

  function handleDeleteSessionFromMenu(targetId: string) {
    setSessionMenu(null);
    if (!confirm("Delete this conversation? This cannot be undone.")) {
      return;
    }
    deleteSession(courseId, targetId);
    setCourses(loadCourses());
    const next = getCourse(courseId);
    setCourse(next ?? null);
    if (selectedSessionId === targetId) {
      setSelectedSessionId(next?.sessions[0]?.id ?? null);
    }
  }

  function backToTopicOverview() {
    setSelectedSessionId(null);
  }

  function selectSession(sessionId: string, sessionName: string) {
    console.log("[chat-ui] selected session/topic", {
      courseId,
      selectedSessionId: sessionId,
      selectedTopic: sessionName,
    });
    setSelectedSessionId(sessionId);
  }

  function handleAssistantMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelectionCandidate(null);
      return;
    }
    const selectedRaw = sel.toString();
    if (!selectedRaw.trim()) {
      setSelectionCandidate(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startEl =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endEl =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    if (!startEl || !endEl) {
      setSelectionCandidate(null);
      return;
    }
    const startMsgEl = startEl.closest("[data-assistant-message-id]");
    const endMsgEl = endEl.closest("[data-assistant-message-id]");
    if (!startMsgEl || !endMsgEl || startMsgEl !== endMsgEl) {
      setSelectionCandidate(null);
      return;
    }
    const sourceMessageId = startMsgEl.getAttribute("data-assistant-message-id");
    if (!sourceMessageId) {
      setSelectionCandidate(null);
      return;
    }
    const assistantTextEl = startMsgEl.querySelector(
      "[data-assistant-text]",
    ) as HTMLElement | null;
    if (!assistantTextEl) {
      setSelectionCandidate(null);
      return;
    }
    const fullText = assistantTextEl.textContent ?? "";
    if (!fullText.trim()) {
      setSelectionCandidate(null);
      return;
    }
    const preRange = document.createRange();
    preRange.setStart(assistantTextEl, 0);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const selectedText = range.toString();
    const endOffset = startOffset + selectedText.length;
    if (startOffset >= endOffset) {
      setSelectionCandidate(null);
      return;
    }
    const selectedTextNormalized = normalizeSelectionText(selectedText);
    if (!selectedTextNormalized) {
      setSelectionCandidate(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelectionCandidate({
      sourceMessageId,
      selectedText,
      startOffset,
      endOffset,
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.top + window.scrollY - 8,
    });
  }

  function activateSelectionCandidate() {
    if (!selectionCandidate) return;
    setActiveAnchor({
      sourceMessageId: selectionCandidate.sourceMessageId,
      selectedText: selectionCandidate.selectedText,
      startOffset: selectionCandidate.startOffset,
      endOffset: selectionCandidate.endOffset,
    });
    setSelectionCandidate(null);
    window.getSelection()?.removeAllRanges();
    chatInputRef.current?.focus();
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || !selectedSessionId || chatSending || !course) return;
    const sid = selectedSessionId;
    const outgoingAnchor = activeAnchor;
    setChatSending(true);
    setChatInput("");
    appendMessage(courseId, sid, {
      role: "user",
      content: text,
      followupAnchor: outgoingAnchor
        ? {
            sourceMessageId: outgoingAnchor.sourceMessageId,
            selectedText: outgoingAnchor.selectedText,
            startOffset: outgoingAnchor.startOffset,
            endOffset: outgoingAnchor.endOffset,
          }
        : undefined,
    });
    setCourse(getCourse(courseId) ?? null);

    const fresh = getCourse(courseId);
    const sess = fresh?.sessions.find((s) => s.id === sid);
    const history = sess?.messages ?? [];
    const apiMessages = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    let highlightFollowup:
      | {
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
        }
      | undefined;
    if (outgoingAnchor) {
      const sourceIdx = history.findIndex(
        (m) => m.id === outgoingAnchor.sourceMessageId && m.role === "assistant",
      );
      const sourceAssistant =
        sourceIdx >= 0 ? history[sourceIdx] : undefined;
      let originalUserQuestion = "";
      if (sourceIdx > 0) {
        for (let i = sourceIdx - 1; i >= 0; i--) {
          if (history[i].role === "user") {
            originalUserQuestion = history[i].content;
            break;
          }
        }
      }
      if (sourceAssistant) {
        highlightFollowup = {
          type: "highlight_followup",
          sourceMessageId: sourceAssistant.id,
          highlight: {
            text: outgoingAnchor.selectedText,
            startOffset: outgoingAnchor.startOffset,
            endOffset: outgoingAnchor.endOffset,
          },
          userQuestion: text,
          context: {
            originalUserQuestion,
            assistantMessage: sourceAssistant.content,
          },
        };
      }
    }
    const uiSelectedTopic = selectedSession?.name ?? "";
    const requestSessionTopic = sess?.name ?? "";
    const requestSessionTopicSlug = sess?.topicSlug ?? "";
    console.log("[chat-ui] send payload topic/session", {
      courseId,
      selectedSessionId: sid,
      uiSelectedTopic,
      requestSessionTopic,
      requestSessionTopicSlug,
      highlightFollowup: highlightFollowup
        ? {
            sourceMessageId: highlightFollowup.sourceMessageId,
            selectedTextPreview: highlightFollowup.highlight.text.slice(0, 120),
            startOffset: highlightFollowup.highlight.startOffset,
            endOffset: highlightFollowup.highlight.endOffset,
          }
        : null,
      messageCount: apiMessages.length,
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          courseId,
          courseName: course.name,
          sessionTopic: requestSessionTopic,
          sessionTopicSlug: requestSessionTopicSlug,
          highlightFollowup,
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const err =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: string }).error === "string"
            ? (data as { error: string }).error
            : "Request failed";
        appendMessage(courseId, sid, {
          role: "assistant",
          content: `Sorry—could not get a reply: ${err}`,
        });
        setCourse(getCourse(courseId) ?? null);
        return;
      }
      const reply =
        typeof data === "object" &&
        data !== null &&
        "reply" in data &&
        typeof (data as { reply: string }).reply === "string"
          ? (data as { reply: string }).reply
          : "";
      if (reply) {
        appendMessage(courseId, sid, { role: "assistant", content: reply });
        setCourse(getCourse(courseId) ?? null);
        setActiveAnchor(null);
        setSelectionCandidate(null);
      }
    } catch {
      appendMessage(courseId, sid, {
        role: "assistant",
        content: "Sorry—network error. Try again.",
      });
      setCourse(getCourse(courseId) ?? null);
    } finally {
      setChatSending(false);
    }
  }

  async function handleGenerateNote() {
    if (!selectedSessionId || !course || chatSending) return;
    const sess = course.sessions.find((s) => s.id === selectedSessionId);
    const msgs = sess?.messages ?? [];
    if (msgs.length === 0) return;
    setNoteGenerating(true);
    try {
      const payload = msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/notes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payload,
          courseName: course.name,
          sessionName: sess?.name ?? "",
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const err =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: string }).error === "string"
            ? (data as { error: string }).error
            : "Failed to generate note";
        alert(err);
        return;
      }
      const d = data as {
        title?: string;
        body?: string;
        rangeIncompleteWarning?: boolean;
      };
      const title = typeof d.title === "string" ? d.title : "Note";
      const content = typeof d.body === "string" ? d.body : "";
      const card = addNoteCard(courseId, {
        topicId: selectedSessionId,
        title,
        content,
      });
      setCourse(getCourse(courseId) ?? null);
      if (card) {
        setTopicNotesExpanded(true);
        setDraftNoteTitle(card.title);
        setDraftNoteContent(card.content);
        setNoteDialog({ mode: "edit", card });
      }
      if (d.rangeIncompleteWarning) {
        alert(
          "Note: the discussion window may be incomplete—the topic may have started earlier in the thread. You can edit the card to add context.",
        );
      }
    } catch {
      alert("Network error while generating note.");
    } finally {
      setNoteGenerating(false);
    }
  }

  function openNoteView(card: NoteCard) {
    setNoteDialog({ mode: "view", card });
  }

  function openNoteEdit(card: NoteCard) {
    setDraftNoteTitle(card.title);
    setDraftNoteContent(card.content);
    setNoteDialog({ mode: "edit", card });
  }

  function handleSaveNoteCard() {
    if (!noteDialog || noteDialog.mode !== "edit") return;
    const updated = updateNoteCard(courseId, noteDialog.card.id, {
      title: draftNoteTitle,
      content: draftNoteContent,
    });
    if (updated) {
      setCourse(getCourse(courseId) ?? null);
      setNoteDialog({ mode: "edit", card: updated });
    }
  }

  function handleDeleteNoteCard(cardId: string) {
    if (!confirm("Delete this note card? This cannot be undone.")) return;
    if (deleteNoteCard(courseId, cardId)) {
      setCourse(getCourse(courseId) ?? null);
      setExpandedNoteIds((ids) => ids.filter((id) => id !== cardId));
      setNoteDialog((cur) =>
        cur?.card.id === cardId ? null : cur,
      );
    }
  }

  function toggleNoteCardExpanded(cardId: string) {
    setExpandedNoteIds((prev) =>
      prev.includes(cardId)
        ? prev.filter((id) => id !== cardId)
        : [...prev, cardId],
    );
  }

  function submitNewConversation() {
    const name = newConvName.trim();
    if (!name) return;
    const activeTopicSlug =
      selectedSessionId != null
        ? course?.sessions.find((x) => x.id === selectedSessionId)?.topicSlug
        : undefined;
    const s = addSession(courseId, name, activeTopicSlug);
    setNewConvOpen(false);
    setNewConvName("");
    setPlusOpen(false);
    if (s) {
      setSelectedSessionId(s.id);
      setCourse(getCourse(courseId) ?? null);
      setCourses(loadCourses());
    }
  }

  if (!ready) {
    return (
      <div className="flex h-screen overflow-hidden items-center justify-center bg-white p-8">
        <p className="text-sm text-[#6b6b6b]">Loading…</p>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="flex h-screen overflow-hidden flex-col items-center justify-center gap-4 bg-white p-8">
        <p className="text-sm text-[#6b6b6b]">Course not found.</p>
        <Link
          href="/course/create"
          className="text-sm text-black underline underline-offset-2"
        >
          Create a course
        </Link>
      </div>
    );
  }

  const sessions: ChatSession[] = course.sessions;
  const selectedSession =
    selectedSessionId != null
      ? sessions.find((s) => s.id === selectedSessionId)
      : undefined;
  const chatMessages = selectedSession?.messages ?? [];

  const persistedAnchors: ActiveFollowupAnchor[] = [];
  for (const m of chatMessages) {
    if (m.role !== "user" || !m.followupAnchor) continue;
    persistedAnchors.push({
      sourceMessageId: m.followupAnchor.sourceMessageId,
      selectedText: m.followupAnchor.selectedText,
      startOffset: m.followupAnchor.startOffset,
      endOffset: m.followupAnchor.endOffset,
    });
  }

  /** No session selected: course topic overview (centered list). Session selected: chat layout. */
  const inTopicChat = selectedSessionId !== null;
  const showCourseRail = !inTopicChat;

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-white text-black">
      {showCourseRail && (
        <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-[#e8e8e8] bg-[#fafafa]">
          <div className="shrink-0 border-b border-[#e8e8e8] p-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a9a]">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.2-4.2" />
                </svg>
              </span>
              <input
                type="search"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-none border border-[#c8c8c8] bg-white py-2 pl-9 pr-2 text-sm outline-none focus:border-[#a3a3a3]"
              />
            </div>
          </div>
          <div className="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide text-[#9a9a9a]">
            Course
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            <ul className="space-y-0.5">
              {filteredCourses.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/course/workspace/${c.id}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCourseMenu({
                        courseId: c.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    className={`flex items-center gap-2 rounded-sm px-2 py-2 text-sm ${
                      c.id === courseId
                        ? "bg-white font-medium text-black shadow-sm"
                        : "text-[#4a4a4a] hover:bg-white/80"
                    }`}
                  >
                    <BookIcon className="h-4 w-4 shrink-0 opacity-70" />
                    <span className="truncate">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="shrink-0 border-t border-[#e8e8e8] p-3">
            <Link
              href="/course/create"
              className="block w-full border border-[#c8c8c8] bg-white py-2 text-center text-sm text-black hover:border-[#a3a3a3]"
            >
              Add course
            </Link>
          </div>
        </aside>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => onUploadMaterial(e.target.files?.[0] ?? null)}
        />

        {!inTopicChat ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex w-full flex-col items-center px-8 py-10">
              <div className="flex w-full max-w-lg flex-col items-center">
                <Link
                  href="/course/create"
                  className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#e8e8e8] bg-[#fafafa] text-[#4a4a4a] transition hover:border-[#c8c8c8]"
                  aria-label="Back to create course"
                >
                  <BookIcon className="h-10 w-10" />
                </Link>

                <div className="flex w-full items-center justify-center gap-2">
                  <h1 className="text-center text-2xl font-normal tracking-tight">
                    {course.name}
                  </h1>
                  <div className="relative" ref={plusRef}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlusOpen((o) => !o);
                      }}
                      className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#c8c8c8] bg-white text-xl font-light leading-none text-[#4a4a4a] transition hover:border-[#a3a3a3]"
                      aria-expanded={plusOpen}
                      aria-haspopup="true"
                      aria-label="Add materials or conversation"
                    >
                      +
                    </button>
                    {plusOpen && (
                      <div
                        className="absolute right-0 top-full z-10 mt-1 min-w-[200px] border border-[#e8e8e8] bg-white py-1 shadow-md"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={uploadBusy}
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f5f5f5] disabled:opacity-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                        >
                          {uploadBusy ? "Uploading…" : "Upload materials"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f5f5f5]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlusOpen(false);
                            setNewConvName("");
                            setNewConvOpen(true);
                          }}
                        >
                          New conversation
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <ul className="mt-10 w-full space-y-2">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectSession(s.id, s.name)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSessionMenu({
                            sessionId: s.id,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        className="flex w-full items-center gap-3 border border-[#e8e8e8] bg-white px-3 py-3 text-left text-sm transition hover:border-[#c8c8c8]"
                      >
                        <BookIcon className="h-4 w-4 shrink-0 text-[#6b6b6b]" />
                        <span className="font-normal">{s.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>

                {sessions.length === 0 && (
                  <p className="mt-6 text-center text-sm text-[#9a9a9a]">
                    No conversations yet. Use + to add one or upload materials.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-row">
            <aside className="flex h-full min-h-0 w-[min(17rem,36vw)] shrink-0 flex-col border-r border-[#e8e8e8] bg-[#f7f7f7]">
              <div className="flex shrink-0 items-center gap-1 border-b border-[#e8e8e8] px-2 py-2">
                <button
                  type="button"
                  onClick={backToTopicOverview}
                  className="shrink-0 rounded px-1.5 py-1 text-[12px] font-medium text-[#6b6b6b] hover:bg-black/5 hover:text-black"
                  aria-label="Back to topic list"
                >
                  Courses
                </button>
                <button
                  type="button"
                  onClick={backToTopicOverview}
                  className="flex shrink-0 items-center justify-center rounded p-1 text-[#6b6b6b] hover:bg-black/5 hover:text-black"
                  aria-label="Back to topic list"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <span className="min-w-0 truncate text-sm font-normal text-[#2a2a2a]">
                  {course.name}
                </span>
              </div>
              <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
                <ul className="flex flex-col gap-0">
                  {sessions.map((s) => {
                    const active = s.id === selectedSessionId;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => selectSession(s.id, s.name)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSessionMenu({
                              sessionId: s.id,
                              x: e.clientX,
                              y: e.clientY,
                            });
                          }}
                          className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pl-1.5 pr-1 text-left text-[13px] leading-snug transition ${
                            active
                              ? "bg-white text-black shadow-sm"
                              : "text-[#4a4a4a] hover:bg-white/70"
                          }`}
                        >
                          <BookIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                          <span className="min-w-0 flex-1 truncate">
                            {s.name}
                          </span>
                          <ChevronIcon
                            direction={active ? "up" : "down"}
                            className="h-3.5 w-3.5 shrink-0 opacity-50"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {sessions.length === 0 && (
                  <p className="px-1.5 py-2 text-[13px] leading-snug text-[#9a9a9a]">
                    No conversations yet — use + in the chat bar to add one or
                    upload materials.
                  </p>
                )}
              </nav>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
              <div
                ref={chatScrollRef}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
                onMouseUp={handleAssistantMouseUp}
              >
                {selectedSession ? (
                  <>
                    <div className="mx-auto flex max-w-2xl flex-col gap-3">
                      {chatMessages.length === 0 && (
                        <p className="text-center text-sm text-[#9a9a9a]">
                          Ask about{" "}
                          <span className="text-[#6b6b6b]">
                            {selectedSession.name}
                          </span>{" "}
                          or the course.
                        </p>
                      )}
                      {chatMessages.map((m) => (
                        <div
                          key={m.id}
                          data-assistant-message-id={
                            m.role === "assistant" ? m.id : undefined
                          }
                          className={`flex ${
                            m.role === "user" ? "justify-end" : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                              m.role === "user"
                                ? "border-black bg-black text-white"
                                : "border-[#e8e8e8] bg-[#fafafa] text-black"
                            }`}
                          >
                            {m.role === "user" && m.followupAnchor && (
                              <div className="mb-2 rounded-md border border-white/30 bg-white/15 px-2 py-1 text-[11px] text-white/90">
                                <p className="mb-0.5 font-medium">
                                  Asking about:
                                </p>
                                <p
                                  className="whitespace-pre-wrap"
                                  style={{
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                  }}
                                >
                                  “{m.followupAnchor.selectedText}”
                                </p>
                              </div>
                            )}
                            <p
                              data-assistant-text={
                                m.role === "assistant" ? "true" : undefined
                              }
                              className="whitespace-pre-wrap"
                            >
                              {m.role === "assistant"
                                ? renderAssistantWithHighlight(
                                    m.content,
                                    activeAnchor,
                                    persistedAnchors,
                                    m.id,
                                  )
                                : m.content}
                            </p>
                          </div>
                        </div>
                      ))}
                      {chatSending && (
                        <div className="flex justify-start">
                          <div className="rounded-lg border border-[#e8e8e8] bg-white px-3 py-2 text-sm text-[#9a9a9a]">
                            Thinking…
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} aria-hidden />
                    </div>

                    <div className="mx-auto mt-8 max-w-2xl border-t border-[#ececec] pt-4">
                      <button
                        type="button"
                        onClick={() =>
                          setTopicNotesExpanded((open) => !open)
                        }
                        className="flex w-full items-center gap-3 rounded-xl border border-[#e5e5e5] bg-[#fafafa] px-3 py-2.5 text-left shadow-sm outline-none transition hover:bg-[#f5f5f5] focus-visible:ring-2 focus-visible:ring-black/15"
                        aria-expanded={topicNotesExpanded}
                        aria-controls="topic-notes-panel"
                        id="topic-notes-toggle"
                      >
                        <ChevronIcon
                          className={`h-4 w-4 shrink-0 text-[#737373] transition-transform duration-200 ${
                            topicNotesExpanded ? "rotate-180" : "-rotate-90"
                          }`}
                          direction="down"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9a9a9a]">
                            Notes
                          </p>
                          <p className="truncate text-sm font-medium text-black">
                            {selectedSession.name}
                          </p>
                        </div>
                        <span className="shrink-0 tabular-nums text-xs text-[#9a9a9a]">
                          {topicNoteCards.length}{" "}
                          {topicNoteCards.length === 1 ? "card" : "cards"}
                        </span>
                      </button>

                      {topicNotesExpanded && (
                        <div
                          id="topic-notes-panel"
                          role="region"
                          aria-labelledby="topic-notes-toggle"
                          className="mt-4"
                        >
                          <p className="text-xs text-[#b0b0b0]">
                            Open this panel to browse notes for this topic. Expand
                            a card for the full text—one card per Generate Note.
                          </p>
                          {topicNoteCards.length === 0 ? (
                            <p className="mt-4 text-sm text-[#9a9a9a]">
                              No note cards yet. Use Generate Note below.
                            </p>
                          ) : (
                            <ul className="mt-4 flex flex-col gap-2.5">
                              {topicNoteCards.map((card) => {
                                const expanded = expandedNoteIds.includes(
                                  card.id,
                                );
                                return (
                                  <li
                                    key={card.id}
                                    className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 shadow-sm"
                                  >
                                    <NoteCardHeader
                                      title={card.title}
                                      createdAt={card.createdAt}
                                      expanded={expanded}
                                      onToggleExpand={() =>
                                        toggleNoteCardExpanded(card.id)
                                      }
                                    />
                                    {!expanded && (
                                      <NoteCardPreview content={card.content} />
                                    )}
                                    {expanded && (
                                      <NoteCardBody content={card.content} />
                                    )}
                                    <div
                                      className={
                                        expanded
                                          ? "mt-3 flex flex-wrap gap-2 border-t border-[#ececec] pt-3"
                                          : "mt-3 flex flex-wrap gap-2"
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => openNoteView(card)}
                                        className="rounded-md border border-[#d4d4d4] bg-white px-2.5 py-1 text-xs font-medium text-[#2a2a2a] hover:bg-[#f5f5f5]"
                                      >
                                        View
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openNoteEdit(card)}
                                        className="rounded-md border border-[#d4d4d4] bg-white px-2.5 py-1 text-xs font-medium text-[#2a2a2a] hover:bg-[#f5f5f5]"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteNoteCard(card.id)
                                        }
                                        className="rounded-md border border-[#e8e8e8] bg-white px-2.5 py-1 text-xs font-medium text-[#b42318] hover:bg-red-50"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full min-h-[120px] flex-col items-center justify-center px-4 text-center text-sm text-[#9a9a9a]">
                    <p>Loading conversation…</p>
                  </div>
                )}
              </div>

              {selectedSession && (
                <div className="shrink-0 border-t border-[#ececec] bg-[#fafafa] px-4 py-2">
                  <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={
                        noteGenerating ||
                        chatMessages.length === 0 ||
                        chatSending
                      }
                      onClick={() => void handleGenerateNote()}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#d4d4d4] bg-white px-3 py-1.5 text-xs font-medium text-[#2a2a2a] shadow-sm transition hover:border-[#a3a3a3] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <NoteDocIcon className="h-4 w-4 text-[#4a4a4a]" />
                      {noteGenerating ? "Generating…" : "Generate Note"}
                    </button>
                  </div>
                </div>
              )}

              {selectionCandidate && (
                <button
                  type="button"
                  onClick={activateSelectionCandidate}
                  className="fixed z-20 -translate-x-1/2 -translate-y-full rounded-full border border-black bg-black px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-neutral-900"
                  style={{
                    left: selectionCandidate.x,
                    top: selectionCandidate.y,
                  }}
                >
                  Ask about this
                </button>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
                className="shrink-0 bg-white px-4 pb-5 pt-2"
              >
                <div className="mx-auto max-w-2xl">
                  {activeAnchor && (
                    <div className="mb-2 rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8a6b00]">
                            Asking about
                          </p>
                          <p
                            className="mt-1 whitespace-pre-wrap text-[#3b2f00]"
                            title={activeAnchor.selectedText}
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            “{activeAnchor.selectedText}”
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveAnchor(null)}
                          className="shrink-0 rounded px-1.5 py-0.5 text-sm text-[#8a6b00] hover:bg-yellow-100"
                          aria-label="Remove highlight anchor"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mx-auto flex max-w-2xl items-end gap-1 rounded-full border border-[#e5e5e5] bg-white py-1.5 pl-4 pr-1.5 shadow-md">
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendChat();
                      }
                    }}
                    rows={1}
                    placeholder={
                      sessions.length === 0
                        ? "Add a conversation with +"
                        : "Message…"
                    }
                    className="max-h-32 min-h-[40px] flex-1 resize-none border-0 bg-transparent py-2 text-sm outline-none placeholder:text-[#a3a3a3] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={
                      chatSending || !selectedSessionId || sessions.length === 0
                    }
                  />
                  <div className="relative shrink-0 pb-0.5" ref={plusRef}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlusOpen((o) => !o);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-lg font-light leading-none text-[#4a4a4a] transition hover:bg-[#f0f0f0]"
                      aria-expanded={plusOpen}
                      aria-haspopup="true"
                      aria-label="Upload materials or new conversation"
                    >
                      +
                    </button>
                    {plusOpen && (
                      <div
                        className="absolute bottom-full right-0 z-10 mb-1 min-w-[200px] border border-[#e8e8e8] bg-white py-1 shadow-md"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={uploadBusy}
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f5f5f5] disabled:opacity-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                        >
                          {uploadBusy ? "Uploading…" : "Upload materials"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f5f5f5]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlusOpen(false);
                            setNewConvName("");
                            setNewConvOpen(true);
                          }}
                        >
                          New conversation
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-[#b0b0b0]">
                  Enter to send · Shift+Enter for new line
                </p>
              </form>
            </section>
          </div>
        )}
      </main>

      {courseMenu && (
        <div
          ref={courseMenuRef}
          role="menu"
          className="fixed z-30 min-w-[160px] border border-[#e8e8e8] bg-white py-1 shadow-md"
          style={{ left: courseMenu.x, top: courseMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-[#b42318] hover:bg-[#f5f5f5]"
            onClick={() => handleDeleteCourseFromMenu(courseMenu.courseId)}
          >
            Delete course
          </button>
        </div>
      )}

      {sessionMenu && (
        <div
          ref={sessionMenuRef}
          role="menu"
          className="fixed z-30 min-w-[180px] border border-[#e8e8e8] bg-white py-1 shadow-md"
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-[#b42318] hover:bg-[#f5f5f5]"
            onClick={() =>
              handleDeleteSessionFromMenu(sessionMenu.sessionId)
            }
          >
            Delete conversation
          </button>
        </div>
      )}

      {newConvOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div
            className="w-full max-w-md border border-[#e8e8e8] bg-white p-6 shadow-lg"
            role="dialog"
            aria-labelledby="new-conv-title"
          >
            <h2 id="new-conv-title" className="text-lg font-normal">
              New conversation
            </h2>
            <label
              htmlFor="new-conv-input"
              className="mt-4 block text-sm text-[#6b6b6b]"
            >
              Name
            </label>
            <input
              id="new-conv-input"
              type="text"
              value={newConvName}
              onChange={(e) => setNewConvName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewConversation();
              }}
              className="mt-2 w-full border border-[#c8c8c8] px-3 py-2 text-sm outline-none focus:border-[#a3a3a3]"
              placeholder="e.g. Greedy algorithms"
              autoFocus
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="border border-[#c8c8c8] bg-white px-4 py-2 text-sm"
                onClick={() => setNewConvOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="border border-black bg-black px-4 py-2 text-sm text-white"
                onClick={submitNewConversation}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {noteDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div
            className="flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col border border-[#e8e8e8] bg-white shadow-xl"
            role="dialog"
            aria-labelledby="note-card-dialog-title"
          >
            {(() => {
              const live =
                topicNoteCards.find((c) => c.id === noteDialog.card.id) ??
                noteDialog.card;
              return noteDialog.mode === "view" ? (
                <>
                  <div className="shrink-0 border-b border-[#ececec] px-5 py-4">
                    <h2
                      id="note-card-dialog-title"
                      className="text-lg font-normal text-black"
                    >
                      {live.title}
                    </h2>
                    <p className="mt-1 text-[11px] text-[#9a9a9a]">
                      Saved{" "}
                      {new Date(live.updatedAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#2a2a2a]">
                      {live.content}
                    </pre>
                  </div>
                  <div className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-[#ececec] px-5 py-4">
                    <button
                      type="button"
                      className="border border-[#c8c8c8] bg-white px-4 py-2 text-sm"
                      onClick={() => setNoteDialog(null)}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="border border-black bg-black px-4 py-2 text-sm text-white"
                      onClick={() => openNoteEdit(live)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="border border-[#fecaca] bg-white px-4 py-2 text-sm text-[#b42318]"
                      onClick={() => handleDeleteNoteCard(live.id)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="shrink-0 border-b border-[#ececec] px-5 py-4">
                    <h2
                      id="note-card-dialog-title"
                      className="text-lg font-normal"
                    >
                      Edit note card
                    </h2>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <label
                      htmlFor="note-card-title"
                      className="block text-sm text-[#6b6b6b]"
                    >
                      Title
                    </label>
                    <input
                      id="note-card-title"
                      type="text"
                      value={draftNoteTitle}
                      onChange={(e) => setDraftNoteTitle(e.target.value)}
                      className="mt-2 w-full border border-[#c8c8c8] px-3 py-2 text-sm outline-none focus:border-[#a3a3a3]"
                    />
                    <label
                      htmlFor="note-card-content"
                      className="mt-4 block text-sm text-[#6b6b6b]"
                    >
                      Content (Markdown)
                    </label>
                    <textarea
                      id="note-card-content"
                      value={draftNoteContent}
                      onChange={(e) => setDraftNoteContent(e.target.value)}
                      rows={16}
                      className="mt-2 w-full resize-y border border-[#c8c8c8] px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:border-[#a3a3a3]"
                    />
                  </div>
                  <div className="shrink-0 flex flex-wrap justify-end gap-2 border-t border-[#ececec] px-5 py-4">
                    <button
                      type="button"
                      className="border border-[#c8c8c8] bg-white px-4 py-2 text-sm"
                      onClick={() => setNoteDialog(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="border border-black bg-black px-4 py-2 text-sm text-white"
                      onClick={() => void handleSaveNoteCard()}
                    >
                      Save
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
