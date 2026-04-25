# ATTRIBUTION

This project was developed with human-led design and implementation. AI tools were used as support for drafting, refactoring suggestions, debugging assistance, and documentation preparation.

## AI tools used

- Cursor AI chat/code assistant
- ChatGPT / large language model assistants used through Cursor

## How AI tools were used

### 1) Drafting and refactoring support

AI tools were used to suggest code drafts and refactoring options for:

- note card data model migration, from topic-level versioned notes to card-based notes
- workspace UI refactors, including card list rendering and collapsible/accordion interactions
- API route cleanup and type-safe request/response handling patterns
- retrieval pipeline structure and helper function organization

### 2) Debugging and error resolution support

AI tools were used to help investigate runtime and integration issues, including:

- React Hooks ordering/runtime errors in `course-workspace-view`
- state synchronization issues after note CRUD operations
- migration edge cases when normalizing legacy note fields

### 3) Documentation and communication support

AI tools were used to draft and refine:

- implementation summaries
- change explanations
- evidence mapping for rubric/self-assessment preparation

## Human modifications, verification, and ownership

All AI-generated or AI-suggested code was reviewed, modified, and tested by the project author(s). Human work included:

- final architecture decisions, including topic/session mapping, note card schema, and retrieval behavior
- adapting AI drafts to project-specific constraints and existing codebase patterns
- manual bug fixing and UX iteration, including collapsible note hierarchy behavior
- validating behavior through local testing, build runs, and iterative correction
- making final evaluation and submission decisions

## Substantial human rework examples

- Reworked the initial note UX suggestion into a topic-scoped card collection with CRUD functionality.
- Fixed a hook-order regression by reorganizing hook placement to satisfy React rules.
- Adjusted note display from a full-content list to a hierarchical collapsible interaction to improve scanning efficiency.
- Refined retrieval logic integration and topic/context flow instead of using generic boilerplate unchanged.

## Scope statement

AI tools accelerated implementation, but did not replace human responsibility for system design, correctness, evaluation, or final submitted content. The final code and submission decisions were made by the project author(s).
