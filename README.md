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

### Error Analysis
PDF Ingestion Memory Overflow

One important failure case in our system occurred during lecture PDF ingestion. Initially, uploading a lecture PDF sometimes caused the RAG pipeline to crash with a Node.js heap out-of-memory error. The issue did not come from the page UI itself, but from the backend ingestion path: after the PDF text was extracted, the system entered the chunking and indexing stage, where memory usage increased abnormally until the process failed.

Our debugging showed that the failure was not simply caused by a very large document. In one representative case, the extracted text was only about 11,264 characters, which is relatively small for a lecture PDF. However, the pipeline still produced 120 chunks and reached the truncation cap. This was a strong signal that the chunking behavior was pathological rather than proportional to document size. In other words, the system was generating far too many chunks for a small amount of text, which then propagated into downstream embedding and database insertion, increasing memory pressure and eventually causing the Node process to approach the 8GB heap limit and crash.

The root cause was an error in the chunking logic. Under certain conditions, the window-advance behavior did not move forward robustly enough, which caused repeated or overly fine-grained chunk generation. This created two linked problems. First, it inflated the number of chunks sent to the embedding and storage pipeline. Second, it polluted the database with many redundant rows for the same topic, making the retrieval layer less reliable even when the system did not fully crash.

We fixed this by correcting the chunking logic, enforcing safer chunk progression, and cleaning the previously corrupted rows from the database before reinserting lecture material. After the fix, the same PDF was processed into only 10 chunks, with no truncation, and the final stored row count for that topic became 10 instead of hundreds of redundant entries. This confirmed that the failure was caused by pipeline logic rather than document size alone.

This failure case was useful because it revealed a structural weakness in our RAG ingestion design: even a modest document can destabilize the system if chunking is not robust. It also motivated an important design principle for our project: in RAG systems, preprocessing logic is as important as retrieval and generation, because errors in ingestion can silently corrupt the entire downstream pipeline.

Before-vs-After Summary Table

| Metric | Before Fix | After Fix | Interpretation |
| --- | --- | --- | --- |
| Extracted text length | 11,264 chars | 11,264 chars | Input document stayed the same |
| Chunk count | 120 | 10 | Original chunking behavior was abnormal |
| Average chunk size | 292.2 chars | 1306 chars | Fixed pipeline produced more reasonable chunk sizes |
| Truncation triggered | Yes | No | Before fix, the pipeline hit the chunk cap |
| Topic rows after ingest | up to 240 / 250 polluted rows | 10 clean rows | Redundant entries were removed after repair |
| System stability | Heap overflow crash | Successful ingest | Fix restored stable ingestion |


Short Discussion of Failure Case

This failure case shows that the quality of a RAG system depends not only on the language model or retrieval algorithm, but also on the reliability of the ingestion pipeline. A small upstream logic error in chunking created downstream effects in memory usage, indexing quality, and retrieval reliability. After fixing the chunking logic and replacing corrupted topic rows, the system became stable and produced clean retrieval-ready lecture chunks. This improvement also made later evaluation more trustworthy, since the indexed data was no longer inflated by duplicated or malformed chunks.

### Documented iterations
We documented multiple evaluation-driven iterations of our RAG system. In the first iteration, lecture PDF ingestion sometimes failed with a Node.js heap out-of-memory error. We diagnosed the issue by logging memory traces, extracted text length, chunk count, and database row counts during ingestion. The measurements showed that a relatively small PDF (11,264 extracted characters) was producing an abnormal 120 chunks and hitting the truncation cap, which then led to memory blow-up and redundant topic rows in the database. We changed the chunking logic to ensure safe forward progress, capped chunk generation more robustly, and cleaned corrupted rows before reinsertion. After this fix, the same PDF was ingested as 10 chunks instead of 120, truncation was removed, and the final stored row count for the topic became 10 clean rows rather than hundreds of polluted entries.

In the second iteration, we found that retrieval quality degraded in multi-file settings because topic/session routing was unstable. We evaluated this by inspecting retrieval logs, including selected shards, loaded chunk count, topic slugs, and top retrieved chunks. The measurements showed that some session-topic combinations produced zero retrieved candidates, causing the system to answer from model prior knowledge rather than document evidence. We changed the retrieval strategy by adding a course-wide fallback when topic-first routing returned zero chunks, and later relaxed hard topic bucketing toward a broader retrieval strategy. This improved behavior by preventing empty-context answers and increasing the chance that the system would retrieve document-grounded evidence instead of hallucinating unsupported content.

A third smaller iteration focused on answer quality for list-style questions. Evaluation showed that even when retrieval was relevant, the model sometimes rewrote or omitted enumerated items from the lecture. We responded by strengthening document-first prompting and adding few-shot guidance for enumeration, numerical fact questions, and document-boundary questions. This improved groundedness for several test questions, especially factual and numerical ones, although list-style extraction remains an area for future refinement.

| Iteration | Observed Problem | Evidence / Measurement | Change Made | Outcome |
|---|---|---|---|---|
| RAG ingestion memory issue | Lecture PDF ingestion sometimes failed with Node.js heap out-of-memory errors. | Logged memory traces, extracted text length, chunk count, and database row counts. One PDF with 11,264 extracted characters produced 120 chunks and hit the truncation cap. | Fixed chunking to ensure safe forward progress, added stronger chunk caps, and cleaned corrupted rows before reinsertion. | The same PDF was ingested as 10 clean chunks instead of 120 polluted chunks. |
| Multi-file retrieval instability | Retrieval quality degraded when topic/session routing returned zero candidates. | Inspected retrieval logs, selected shards, loaded chunk counts, topic slugs, and top retrieved chunks. Some session-topic combinations produced zero retrieved candidates. | Added course-wide fallback and relaxed hard topic bucketing toward broader retrieval. | Reduced empty-context answers and increased document-grounded responses. |
| List-style answer quality | The model sometimes rewrote or omitted enumerated lecture items. | Tested factual, numerical, and list-style questions against retrieved lecture content. | Strengthened document-first prompting and added few-shot guidance for enumeration and document-boundary questions. | Improved groundedness for factual and numerical questions; list-style extraction remains a future improvement area. |

### Prompt Engineering with Evaluation

| Prompt Design | Core Prompt Idea | Example Question | Example Output Behavior | Strengths | Weaknesses | Overall Evaluation |
|---|---|---|---|---|---|---|
| A. Baseline natural answer | Answer naturally after retrieval, without explicitly enforcing document-first behavior. | What three alternative approaches to learning representations besides neural networks are mentioned in this lecture? | Fluent, but sometimes mixed lecture evidence with general background knowledge. In some cases, lecture-specific items were replaced with related concepts not explicitly listed in the document. | Natural and readable; good user experience for simple questions. | Weak grounding; unclear source boundaries; list-style questions were prone to drift or substitution. | Good fluency, but insufficient reliability for document-grounded QA. |
| B. Structured document-first answer | Force the answer into explicit sections such as "According to the document," "Whether explicitly mentioned," and "Extra context." | Does this lecture explicitly mention ridge regression? | More constrained and document-faithful. It correctly distinguished between content explicitly stated in the lecture and related background knowledge. | Stronger grounding; clearer document-vs-background boundaries; better on boundary questions. | Too rigid and somewhat mechanical; less natural for normal interaction. | Improved faithfulness, but the format felt too templated for regular use. |
| C. Natural document-first + few-shot guidance | Keep document-first behavior but make output natural. Add few-shot examples for list, numerical fact, and document-boundary questions. | What is the generalization gap in the train/test split example, and how does the lecture interpret it? / What is the optional warning in the one-hot encoding section? | Best overall balance. More grounded than baseline and more natural than the structured version. Numerical and boundary questions improved, though some list questions could still omit one item. | Best tradeoff between naturalness and grounding; stronger factual, numerical, and boundary behavior. | Enumeration robustness is still imperfect; occasional omission remains possible. | Best overall prompt design among the three tested versions. |


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

`http://localhost:3000/course/create`

## Environment Variables
- `OPENAI_API_KEY` (required): used for LLM calls and embeddings in syllabus parsing, chat, retrieval, and note generation.

## Video Links
- Demo video: https://youtu.be/qiU5bcOtciM?si=_TaPyAlsX_gMY7Q4
- Technical walkthrough: https://youtu.be/qiU5bcOtciM?si=Nduf47kOo06Rmomc

The demo video is intended for a non-specialist audience and should focus on end-user workflow. The technical walkthrough should explain code structure, ML techniques, and key technical contributions.

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
