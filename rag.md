# RAG Design Specification

## 1. Goal

The RAG system in this project is not a generic document QA pipeline.

It should be:

- course-aware
- topic-aware
- incrementally updated over time

The system is designed for course learning workflows, where:
- the syllabus defines the course structure
- lecture materials provide the main learning content
- textbook content is selectively added as supplementary knowledge

The goal is to support topic-based learning chats with retrieval grounded in course materials.


## 2. High-Level Design Principles

1. Do not treat all uploaded documents as equally important.
2. Do not use one global vector store for all courses.
3. Do not blindly index entire textbooks by default.
4. Retrieval should respect:
   - current course
   - current topic
   - source priority
5. The knowledge base should grow incrementally as new lecture materials are uploaded.
6. Keep the MVP simple and inspectable.


## 3. Source Layers

### 3.1 Syllabus = Structure Layer

The syllabus is used for:
- course name extraction
- topic extraction
- topic ordering
- week/topic mapping
- course-level structure

The syllabus is NOT the primary source for deep learning explanations.

It should mainly provide:
- course structure
- navigation context
- retrieval boundary hints


### 3.2 Lecture Materials = Primary Knowledge Layer

Lecture materials include:
- slides
- lecture notes
- handwritten notes
- handouts

These are the primary knowledge source for answering learning questions because they are closest to what the instructor actually teaches.

Retrieval should prioritize lecture materials over other sources whenever possible.


### 3.3 Textbook = Supplementary Knowledge Layer

The textbook is used to enrich and supplement course understanding.

It should provide:
- more complete explanations
- more formal definitions
- additional examples
- clearer textbook-level structure

The textbook must NOT be blindly indexed in full by default.

Instead, the system should:
1. extract the textbook structure first
2. identify relevant chapters/sections
3. selectively index matched content only


## 4. Knowledge Base Boundary

### 4.1 One Course = One Knowledge Base

For the MVP:
- each course should have its own course-level index / knowledge base
- do NOT use one shared global index for all courses
- do NOT create one separate vector store per topic yet

Topic awareness should be implemented using metadata inside a course-level knowledge base.


## 5. Metadata Schema

Each embedded chunk should include metadata where possible:

- courseId
- sourceType
  - syllabus
  - lecture_material
  - handwritten_note_summary
  - textbook
- topic
- week
- fileName
- chapter
- section
- page
- priority
- indexedAt

Not all fields are required for every source, but the schema should support them.


## 6. Handwritten Notes Strategy

Handwritten lecture notes should NOT be treated like normal clean text.

For handwritten notes:
1. first process them with a multimodal model
2. generate sub-module structured summaries
3. embed the summaries instead of the raw handwritten page text
4. preserve page references for traceability

Each page-level summary may contain:
- page number
- inferred topic
- summary
- key concepts
- formulas or definitions if identifiable
- optional textbook-related queries
- source reference

This preprocessing layer is necessary because raw handwritten notes are not reliable for direct text-based RAG.


## 7. Textbook Ingestion Strategy

### 7.1 Do Not Fully Index the Whole Textbook by Default

Users may upload an entire textbook PDF, but the system should not blindly treat all pages as equally relevant.

The system should first identify structure and relevance.


### 7.2 Textbook Structure First

Before indexing textbook content, the system should extract textbook structure if possible:
- chapter titles
- section titles
- subsection titles
- table of contents

This structure is used as the first filtering layer.


### 7.3 Relevance Matching

Relevant textbook sections should be matched using:
- syllabus-derived course topics
- lecture material summaries
- key concepts extracted from lecture materials
- optional textbook query phrases

The system should identify the most relevant textbook chapters/sections for the current course topic.


### 7.4 Selective Indexing

Only matched textbook chapters/sections should be prioritized for indexing.

The system should:
- avoid full-book indexing by default
- avoid indexing preface, acknowledgements, bibliography, index, and similar irrelevant sections
- avoid re-indexing the same textbook section repeatedly

Textbook content is supplementary, not the default top-priority source.


## 8. Incremental Update Strategy

The RAG system should grow over time.

### 8.1 Initial Course Setup
When a course is created from a syllabus:
- extract course name
- extract ordered topics
- create topic chats
- initialize course structure

### 8.2 Incremental Update on New Lecture Material Upload
When new lecture materials are uploaded:
1. parse or summarize the new material
2. infer the current topic
3. extract key concepts
4. optionally generate textbook-related queries
5. match relevant textbook sections
6. index only the new relevant content
7. update the course-level knowledge base

This means the knowledge base is dynamic and grows as the course progresses.


## 9. Retrieval Strategy

Retrieval in topic chats should follow these constraints:

### 9.1 Course Boundary
Only retrieve from the current course.

### 9.2 Topic Awareness
Prioritize chunks relevant to the current topic.

### 9.3 Source Priority
Prefer sources in this order:
1. lecture materials
2. handwritten note summaries
3. matched textbook sections
4. syllabus

The syllabus should mainly serve as structural and contextual support, not as the main content source for deep explanations.


## 10. Chunking Strategy

### 10.1 Syllabus
Chunk by:
- section
- schedule block
- weekly topic block

### 10.2 Lecture Materials
Chunk by:
- page
- topic section
- slide block / note block

### 10.3 Handwritten Notes
Do not directly chunk raw handwritten content.
Chunk the page-level structured summaries.

### 10.4 Textbook
Prefer chunking by:
- chapter
- section
- subsection

Avoid arbitrary full-book fixed-size chunking when possible.


## 11. MVP Scope

The MVP should focus on the following:

### Must Have
- syllabus ingestion
- course/topic extraction
- topic-based chats
- course-level knowledge base
- topic-aware retrieval
- lecture material ingestion
- handwritten note summary preprocessing if handwritten notes are used

### Good to Have
- selective textbook enrichment
- section-level textbook matching
- source links to original pages

### Not in MVP
- one global vector store
- separate vector store per topic
- full-book semantic parser
- advanced reranking pipeline
- complex agent planning
- automatic mastery modeling
- full multimodal retrieval over raw note images


## 12. Engineering Constraints

- Keep the pipeline simple and debuggable.
- Prefer explicit metadata over hidden heuristics.
- Prefer selective indexing over massive blind indexing.
- Prefer inspectable intermediate outputs.
- Use fallback-safe behavior when parsing fails.
- The system should be understandable and presentable in a course project context.


## 13. Summary

This project uses a course-aware, topic-aware, and incrementally updated RAG design.

- Syllabus defines structure
- Lecture materials provide primary knowledge
- Handwritten notes are converted into structured summaries first
- Textbook content is selectively added as supplementary knowledge
- Each course has its own knowledge base
- Retrieval should prioritize current course, current topic, and source importance