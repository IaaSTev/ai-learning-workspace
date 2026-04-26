"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatSession, CourseWorkspace } from "@/lib/workspace-storage";
import { loadCourses, upsertCourse } from "@/lib/workspace-storage";

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3" strokeLinecap="round" />
    </svg>
  );
}

function DocPageIcon({ className }: { className?: string }) {
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

type ParseTopic = { title: string };

type ParseResult = {
  courseName: string;
  topics: ParseTopic[];
};

type TopicRow = {
  id: string;
  title: string;
};

function newTopicId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `topic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toTopicSlug(label: string): string {
  const t = label.trim().toLowerCase();
  const s = t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "general";
}

export function CourseCreateForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Remount file input when clearing so React never treats it as switching controlled/uncontrolled. */
  const [fileInputKey, setFileInputKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState<"pdf" | "url">("pdf");
  const [pageUrl, setPageUrl] = useState("");
  const [screen, setScreen] = useState<"upload" | "results">("upload");
  const [courseName, setCourseName] = useState("");
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const savedCourses = useMemo(
    () => (sidebarOpen ? loadCourses() : []),
    [sidebarOpen],
  );

  useEffect(() => {
    if (!sidebarOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const filteredCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    if (!q) return savedCourses;
    return savedCourses.filter((c) => c.name.toLowerCase().includes(q));
  }, [savedCourses, courseSearch]);

  function openPicker() {
    inputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0];
    setFile(next ?? null);
    setError(null);
  }

  function applyParseResult(data: unknown) {
    const result = data as ParseResult;
    const name =
      typeof result.courseName === "string"
        ? result.courseName
        : result.courseName != null
          ? String(result.courseName)
          : "";
    setCourseName(name);
    setTopics(
      (Array.isArray(result.topics) ? result.topics : []).map(
        (t: ParseTopic | string) => {
          if (typeof t === "string") {
            return { id: newTopicId(), title: t.trim() };
          }
          const raw =
            t && typeof t === "object" && "title" in t
              ? (t as { title: unknown }).title
              : "";
          const title =
            typeof raw === "string"
              ? raw
              : raw != null
                ? String(raw)
                : "";
          return { id: newTopicId(), title: title.trim() };
        },
      ),
    );
    setScreen("results");
  }

  async function handleParse() {
    if (!file) return;

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/parse-syllabus", {
        method: "POST",
        body: formData,
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Request failed";
        setError(message);
        return;
      }

      applyParseResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleParseFromUrl() {
    const trimmed = pageUrl.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/parse-syllabus-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });

      const data: unknown = await res.json();

      if (!res.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : "Request failed";
        setError(message);
        return;
      }

      applyParseResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateTopicTitle(id: string, title: string) {
    setTopics((prev) =>
      prev.map((row) => (row.id === id ? { ...row, title } : row)),
    );
  }

  function deleteTopic(id: string) {
    setTopics((prev) => prev.filter((row) => row.id !== id));
  }

  function addTopic() {
    setTopics((prev) => [...prev, { id: newTopicId(), title: "" }]);
  }

  async function handleCreateCourseWorkspace() {
    const name = courseName.trim() || "Untitled course";
    const courseId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `course-${Date.now()}`;

    const newId = () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const now = Date.now();
    const sessions: ChatSession[] = [];
    for (const t of topics) {
      const title = t.title.trim();
      if (!title) continue;
      sessions.push({
        id: newId(),
        name: title,
        topicSlug: toTopicSlug(title),
        createdAt: now,
        messages: [],
      });
    }
    if (sessions.length === 0) {
      sessions.push({
        id: newId(),
        name: "Conversation 1",
        topicSlug: "general",
        createdAt: now,
        messages: [],
      });
    }

    const course: CourseWorkspace = {
      id: courseId,
      name,
      topics: topics.map((t) => ({ id: t.id, title: t.title })),
      sessions,
      createdAt: now,
      noteCards: [],
    };
    upsertCourse(course);

    const topicPayload = topics
      .map((t) => ({ title: t.title.trim() }))
      .filter((t) => t.title);
    try {
      await fetch("/api/rag/sync-syllabus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          courseName: name,
          topics: topicPayload,
        }),
      });
    } catch {
      /* RAG syllabus sync is best-effort; workspace still works */
    }

    router.push(`/course/workspace/${courseId}`);
  }

  function handleBackToUpload() {
    setScreen("upload");
    setCourseName("");
    setTopics([]);
    setError(null);
    setFile(null);
    setPageUrl("");
    setFileInputKey((k) => k + 1);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-1 flex-col bg-white">
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          sidebarOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        id="course-create-sidebar"
        aria-label="Courses"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(100vw,20rem)] flex-col border-r border-[#e8e8e8] bg-[#f7f7f7] shadow-[4px_0_24px_rgba(0,0,0,0.06)] transition-transform duration-200 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-end border-b border-[#ececec] px-2 py-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-2 text-[#6b6b6b] transition hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            aria-label="Close course list"
          >
            <span className="block text-xl font-light leading-none">×</span>
          </button>
        </div>

        <div className="px-3 pt-1 pb-3">
          <label htmlFor="course-sidebar-search" className="sr-only">
            Search courses
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a9a9a]" />
            <input
              id="course-sidebar-search"
              type="search"
              placeholder="Search"
              value={courseSearch}
              onChange={(e) => setCourseSearch(e.target.value)}
              autoComplete="off"
              className="h-10 w-full rounded-lg border border-[#e0e0e0] bg-white py-2 pl-9 pr-3 text-sm text-black outline-none placeholder:text-[#9a9a9a] focus:border-[#c8c8c8] focus-visible:ring-2 focus-visible:ring-black/15"
            />
          </div>
        </div>

        <p className="px-4 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#9a9a9a]">
          Course
        </p>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
          aria-label="Saved courses"
        >
          {filteredCourses.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[#9a9a9a]">
              {savedCourses.length === 0
                ? "No courses yet. Parse a syllabus to create one."
                : "No matches."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filteredCourses.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/course/workspace/${c.id}`}
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-black transition hover:bg-white hover:shadow-[0_1px_8px_rgba(0,0,0,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                  >
                    <DocPageIcon className="h-4 w-4 shrink-0 text-[#6b6b6b]" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="border-t border-[#e5e5e5] bg-[#f7f7f7] p-3">
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(false);
              setCourseSearch("");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-[#e0e0e0] bg-white px-3 py-2.5 text-left text-sm font-medium text-black shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-[#c8c8c8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
              +
            </span>
            Add course
          </button>
        </div>
      </aside>

      <div className="relative flex w-full flex-1 flex-col px-8 py-14 sm:px-12 sm:py-16">
        <button
          type="button"
          aria-label={sidebarOpen ? "Close menu" : "Open menu"}
          aria-expanded={sidebarOpen}
          aria-controls="course-create-sidebar"
          onClick={() => setSidebarOpen((o) => !o)}
          className="absolute left-6 top-6 z-30 rounded-md p-2 text-black transition hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <span className="flex flex-col gap-1.5">
            <span className="block h-px w-5 bg-black" />
            <span className="block h-px w-5 bg-black" />
            <span className="block h-px w-5 bg-black" />
          </span>
        </button>

        {screen === "upload" ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
            <h1 className="text-2xl font-normal tracking-tight text-black sm:text-3xl">
              To learn a new course?
            </h1>

            {inputMode === "pdf" ? (
              <p className="mt-4 max-w-md text-sm text-[#6b6b6b] sm:text-base">
                Upload a syllabus PDF, or switch to Web to paste a course URL.
              </p>
            ) : (
              <p className="mt-4 max-w-md text-sm text-[#6b6b6b] sm:text-base">
                Paste a public course or syllabus page (http/https). Login-only
                pages cannot be read.
              </p>
            )}

            <div className="mt-6 flex max-w-md gap-2">
              <button
                type="button"
                onClick={() => {
                  setInputMode("pdf");
                  setError(null);
                }}
                className={`h-9 flex-1 whitespace-nowrap rounded-none border text-sm ${
                  inputMode === "pdf"
                    ? "border-black bg-black text-white"
                    : "border-[#c8c8c8] bg-white text-[#6b6b6b]"
                }`}
              >
                PDF file
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputMode("url");
                  setError(null);
                }}
                className={`h-9 flex-1 whitespace-nowrap rounded-none border text-sm ${
                  inputMode === "url"
                    ? "border-black bg-black text-white"
                    : "border-[#c8c8c8] bg-white text-[#6b6b6b]"
                }`}
              >
                Web
              </button>
            </div>

            {inputMode === "pdf" ? (
              <>

                <input
                  key={fileInputKey}
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  aria-label="Upload PDF syllabus"
                  onChange={onFileChange}
                />

                <button
                  type="button"
                  onClick={openPicker}
                  className="mt-6 flex h-11 w-full max-w-md cursor-pointer items-center justify-between border border-[#c8c8c8] bg-white px-4 text-left text-sm outline-none transition hover:border-[#a3a3a3] focus-visible:ring-2 focus-visible:ring-black/20"
                >
                  <span
                    className={`min-w-0 flex-1 truncate ${file ? "text-black" : "text-[#6b6b6b]"}`}
                    aria-live={file ? "polite" : undefined}
                  >
                    {file ? file.name : ""}
                  </span>
                  <span
                    className="ml-2 shrink-0 text-lg font-light leading-none text-[#4a4a4a]"
                    aria-hidden
                  >
                    +
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!file || isLoading}
                  className="mt-6 h-11 w-full max-w-md border border-black bg-black text-sm font-medium tracking-wide text-white transition enabled:hover:bg-neutral-900 enabled:focus-visible:ring-2 enabled:focus-visible:ring-black/30 disabled:cursor-not-allowed disabled:border-[#c8c8c8] disabled:bg-[#e8e8e8] disabled:text-[#9a9a9a]"
                >
                  {isLoading ? "Parsing…" : "Parse Syllabus"}
                </button>
              </>
            ) : (
              <>
                <label htmlFor="syllabus-url" className="sr-only">
                  Course page URL
                </label>
                <input
                  id="syllabus-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  value={pageUrl}
                  onChange={(e) => setPageUrl(e.target.value)}
                  className="mt-6 h-11 w-full max-w-md border border-[#c8c8c8] bg-white px-3 text-left text-sm text-black outline-none placeholder:text-[#9a9a9a] focus:border-[#a3a3a3] focus-visible:ring-2 focus-visible:ring-black/20"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={handleParseFromUrl}
                  disabled={!pageUrl.trim() || isLoading}
                  className="mt-6 h-11 w-full max-w-md border border-black bg-black text-sm font-medium tracking-wide text-white transition enabled:hover:bg-neutral-900 enabled:focus-visible:ring-2 enabled:focus-visible:ring-black/30 disabled:cursor-not-allowed disabled:border-[#c8c8c8] disabled:bg-[#e8e8e8] disabled:text-[#9a9a9a]"
                >
                  {isLoading ? "Parsing…" : "Parse web page"}
                </button>
              </>
            )}

            {error && (
              <p className="mt-4 max-w-md text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-2 pb-8">
            <h2 className="text-center text-lg font-normal tracking-tight text-[#6b6b6b]">
              Review & edit
            </h2>

            <label
              htmlFor="course-name"
              className="mt-8 block text-left text-sm text-[#6b6b6b]"
            >
              Course name
            </label>
            <input
              id="course-name"
              type="text"
              value={courseName ?? ""}
              onChange={(e) => setCourseName(e.target.value)}
              className="mt-2 h-11 w-full border border-[#c8c8c8] bg-white px-3 text-base text-black outline-none transition placeholder:text-[#9a9a9a] focus:border-[#a3a3a3] focus-visible:ring-2 focus-visible:ring-black/20"
              placeholder="Course name"
              autoComplete="off"
            />

            <p className="mt-8 text-left text-sm text-[#6b6b6b]">Topics</p>
            <ul className="mt-3 flex flex-col gap-3">
              {topics.map((topic) => (
                <li key={topic.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={topic.title ?? ""}
                    onChange={(e) =>
                      updateTopicTitle(topic.id, e.target.value)
                    }
                    className="min-w-0 flex-1 h-11 border border-[#c8c8c8] bg-white px-3 text-base text-black outline-none transition placeholder:text-[#9a9a9a] focus:border-[#a3a3a3] focus-visible:ring-2 focus-visible:ring-black/20"
                    placeholder="Topic title"
                    aria-label={`Topic: ${topic.title || "untitled"}`}
                  />
                  <button
                    type="button"
                    onClick={() => deleteTopic(topic.id)}
                    className="shrink-0 px-3 py-2 text-sm text-[#6b6b6b] underline underline-offset-2 transition hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={addTopic}
              className="mt-4 h-11 w-full border border-[#c8c8c8] bg-white text-sm font-medium tracking-wide text-black transition hover:border-[#a3a3a3] focus-visible:ring-2 focus-visible:ring-black/20"
            >
              Add Topic
            </button>

            <button
              type="button"
              onClick={handleCreateCourseWorkspace}
              className="mt-6 h-11 w-full border border-black bg-black text-sm font-medium tracking-wide text-white transition hover:bg-neutral-900 focus-visible:ring-2 focus-visible:ring-black/30"
            >
              Create Course Workspace
            </button>

            <button
              type="button"
              onClick={handleBackToUpload}
              className="mt-4 h-11 w-full border border-[#c8c8c8] bg-white text-sm font-medium tracking-wide text-black transition hover:border-[#a3a3a3] focus-visible:ring-2 focus-visible:ring-black/20"
            >
              Upload another syllabus
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
