# AI Learning Workspace: Topic-Centered Study Assistant

## What it Does
This project is an AI-powered learning workspace that organizes study around course topics instead of one long chat. It parses a syllabus into structured topics, supports topic-scoped AI conversations, retrieves relevant course materials through a custom RAG pipeline, allows highlight-based follow-up on confusing assistant text, and generates editable note cards from discussion blocks for later review.

## Project Motivation / Unified Goal
Students often use AI tools through scattered Q&A. This creates fragmented learning: ideas are hard to organize by topic, useful explanations are easily lost, and review is inefficient.

The project goal is to build a metacognitive learning workspace that connects questions, explanations, materials, and notes around course topics.

The system is intentionally unified: syllabus parsing, topic-based chat, retrieval grounding, highlight follow-up, and note-card generation all serve the same objective of moving from isolated conversations to structured, reviewable topic-based learning.

## System Workflow
1. User creates a course.
2. User uploads or parses a syllabus.
3. The system extracts structured course topics.
4. User enters a topic workspace.
5. User asks questions under that topic.
6. The system retrieves relevant uploaded course materials.
7. User can highlight confusing text and ask focused follow-up questions.
8. User can generate editable note cards from the current discussion block.
9. User can review notes through a collapsible note hierarchy.

## Key Features
- Syllabus parsing into structured course topics.
- Topic-based AI chat workspace.
- RAG over uploaded lecture/course materials.
- Highlighted follow-up question interaction.
- Editable note card generation from discussions.
- Collapsible note card hierarchy for review.
- Local workspace/course/session/message/note-card state management.

## Technical Approach
This project uses pretrained/API-based ML components rather than training a model from scratch. OpenAI API calls are integrated for syllabus parsing, topic-aware chat, and note generation. Embeddings are used for semantic retrieval over uploaded materials.

The RAG path is custom: material ingestion, text cleaning/chunking, embedding generation, cosine-similarity retrieval, and topic-aware ranking behavior. The chat flow maintains multi-turn conversation context and supports focused follow-up prompts from highlighted assistant text. Prompt design is used for structured extraction, grounded response behavior, and note generation.

## Technical Architecture
- Next.js / React frontend.
- Next.js API routes for backend logic.
- OpenAI API for LLM and embedding calls.
- Custom RAG utilities for chunking, embedding, ingestion, retrieval, and storage.
- Browser-local workspace state persistence for courses/sessions/messages/notes.

Architecture flow:  
Frontend UI -> API routes -> LLM / embeddings -> retrieval utilities -> workspace storage -> rendered topic chat and notes.

## Design Choices
- Topic-centered organization instead of one long general chat.
- Manual note generation instead of automatic every-turn note updates.
- Editable AI-generated notes instead of read-only summaries.
- Highlight-based follow-up to reduce friction when users are confused by a specific phrase.
- RAG over uploaded course materials to ground responses in course context.
- Collapsible note hierarchy to make review more scannable.

## Evaluation
This project currently emphasizes qualitative and implementation-grounded evaluation rather than benchmark-style accuracy claims.

Current qualitative testing outcomes:
- Syllabus parsing extracts course-relevant topics and can filter noisy administrative/web content.
- Topic-based chat keeps conversations organized by thread/topic.
- RAG retrieval returns relevant chunks from uploaded course materials.
- Highlighted follow-up enables targeted clarification.
- Note generation produces editable drafts for revision and review.
- Collapsible notes improve scanning compared with full-content always-expanded lists.

No unsupported quantitative accuracy numbers are claimed here.

Limitations:
- Topic boundary detection for note generation is heuristic.
- Note generation quality depends on conversation quality and context.
- RAG quality depends on uploaded material quality and chunking/retrieval behavior.
- The system supports learning but does not replace instructor guidance or authoritative course materials.

## Evidence Pointers
- Syllabus parsing (file): `app/api/parse-syllabus/route.ts`
- Syllabus parsing (URL): `app/api/parse-syllabus-url/route.ts`
- Course creation UI: `app/course/create/course-create-form.tsx`
- Workspace UI: `app/course/workspace/[courseId]/course-workspace-view.tsx`
- Highlight follow-up interaction: `app/course/workspace/[courseId]/course-workspace-view.tsx`, `app/api/chat/route.ts`
- Note generation API: `app/api/notes/generate/route.ts`
- Note/card storage: `lib/workspace-storage.ts`
- RAG ingestion: `app/api/rag/ingest-lecture/route.ts`, `lib/rag/ingest-lecture.ts`
- Text chunking: `lib/rag/chunk-text.ts`
- Embeddings: `lib/rag/embeddings.ts`
- Retrieval: `lib/rag/retrieve.ts`
- Attribution: `ATTRIBUTION.md`
- Setup instructions: `README.md` (Quick Start)

## Quick Start
```bash
git clone <repo-url>
cd study-agent-mvp
npm install
```

Then:

```bash
cp .env.example .env.local
```

If `.env.example` is unavailable in your environment:

```bash
touch .env.local
```

Set this in `.env.local`:

```bash
OPENAI_API_KEY=your_api_key_here
```

Then run:

```bash
npm run dev
```

Open:

`http://localhost:3000`

## Environment Variables
- `OPENAI_API_KEY` (required): used for LLM calls and embeddings in syllabus parsing, chat, retrieval, and note generation.

## Video Links
- Demo video: [add link here]
- Technical walkthrough: [add link here]

The demo video is intended for a non-specialist audience and should focus on end-user workflow. The technical walkthrough should explain code structure, ML techniques, and key technical contributions.

## Individual Contributions
Team member 1: [name] — [main responsibilities]  
Team member 2: [name] — [main responsibilities]

Possible responsibility areas:
- syllabus parsing and course creation flow
- topic workspace UI
- RAG ingestion/retrieval pipeline
- note card generation and storage
- highlight follow-up interaction
- debugging, testing, documentation, and demo preparation

## AI Tool Attribution
AI tools were used for drafting, refactoring suggestions, debugging support, and documentation assistance. All AI-generated or AI-suggested code was reviewed, modified, and tested by the project authors.

See: `ATTRIBUTION.md`

## Repository Organization
- `app/`
  - `app/course/create/*`: course creation UI and syllabus parsing flow.
  - `app/course/workspace/[courseId]/*`: topic workspace chat and notes UI.
  - `app/api/*`: routes for chat, notes generation, syllabus parsing, and RAG ingestion/sync.
- `lib/`
  - `lib/course-extraction.ts`: syllabus/course extraction.
  - `lib/openai-chat-json.ts`: JSON-structured LLM helper.
  - `lib/workspace-storage.ts`: local workspace state for courses/sessions/messages/note cards.
  - `lib/rag/*`: chunking, embeddings, ingestion, retrieval, storage, and related utilities.
- `data/rag/*`: local persisted retrieval data artifacts.
- `public/*`: static assets.

## Limitations and Future Work
- Improve topic boundary detection.
- Improve retrieval ranking/reranking.
- Add more systematic evaluation of note quality.
- Support stronger persistent topic IDs and better topic segmentation.
- Improve handling of long PDFs and larger course material collections.
- Add stronger guardrails and explicit hallucination evaluation.
