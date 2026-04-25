# Note Generation Logic (MVP)

## Goal

When the user clicks **Generate Note**, the system should not simply summarize messages “since the last click.”

Instead, the system should trace back to the **starting point of the current topic** and generate a note for the **current discussion block**.

The generated content should not be treated as the AI’s final conclusion. It should be treated as an **editable initial note draft**. The user can freely revise, delete, expand, and add their own understanding, reflections, and additional information.

---

## Core Decision

For the MVP, note generation works as follows:

- manually triggered only
- based on the current topic block
- identified by:
  - looking back at the **most recent 15 messages**
  - asking the model to determine:
    1. what the current core topic is
    2. which message among the 15 messages is the starting point of that topic

---

## Why This Design

Using “messages since the last note generation” as the note range is logically incorrect because note boundaries should follow **topic boundaries**, not **button-click timing**.

For example:

- The user first asks, “How often should notes be updated?”
- Later, the user asks, “How far back should note generation trace?”
- Both happened after the previous note-generation click.
- However, the current note may only need to include the second part.

Therefore, the correct logic should be:

> Generate notes from the starting point of the current topic, not from the last note-generation point.

---

## MVP Workflow

### Step 1: User clicks `Generate Note`

This is the only trigger in the MVP.

---

### Step 2: Retrieve the recent conversation window

The system reads the **most recent 15 messages** in the current conversation.

Notes:

- Count both **user** and **assistant** messages.
- Preserve message order.
- If message IDs exist, include them as well.

---

### Step 3: Ask the model to identify the topic boundary

At this stage, the model’s task is **boundary detection**, not note writing.

The model must output:

- `topic`: the core topic of the current discussion
- `start_index`: which message among the 15 messages is the starting point of the current topic
- `uncertain`: whether the model is uncertain
- `reason`: a brief explanation

### Expected Output Format

```json
{
  "topic": "Backtracking logic for note generation scope",
  "start_index": 6,
  "uncertain": false,
  "reason": "Starting from message 6, the discussion shifts to how the system should trace back to the topic starting point. Earlier messages focus on note update frequency."
}
Step 4: Determine the note input range

If uncertain = false:

Use the content from start_index to the latest message.
Send this selected range to the note generator.

If uncertain = true:

Expand the window and retry once.

Recommended fallback:

First attempt: 15 messages
Second attempt: 25 messages

If the model is still uncertain after the second attempt:

generate the note using the larger window, or
show a UI warning that the selected range may be incomplete
Step 5: Generate the initial note draft

After identifying the topic boundary, the system generates an editable initial note draft based on the selected message range.

This content is not a read-only summary. It is the starting point for the user’s own note.

The system should directly enter the note editing interface and allow the user to revise the draft, including:

changing the title
rewriting wording
deleting unnecessary parts
adding personal understanding
adding extra examples
recording personal reflections
adding important content that did not explicitly appear in the conversation

After saving, this content becomes the note version for the current topic.

Important Principle

The model needs to find:

the earliest starting point of the current discussion chain

Not:

the user’s latest message
the assistant’s most recent explanation
the point after the previous note generation
earlier content that is only loosely semantically related
Boundary Detection Rules
Cases that should usually belong to the same topic

The following usually remain part of the same discussion block:

follow-up questions
clarification questions
examples
correction of misunderstandings
rephrasing the same problem
implementation details under the same design question

Examples:

“Then how exactly should we implement it?”
“I still do not quite understand.”
“What if we only trigger it manually?”
“Should this range trace back to the topic starting point?”
Cases that should usually start a new topic

The following usually indicate a topic switch:

the user explicitly says they want to discuss another issue
the new question becomes a different design problem
the previous issue is resolved and the focus clearly shifts

Examples:

“Next, let’s discuss the highlight follow-up feature.”
“Now let’s talk about the database structure.”
“Switching to another question.”
Prompt for Boundary Detection
System / Developer Intent

The model is not summarizing at this stage.

The model’s task is to identify the starting point of the current topic block within a recent conversation window.

Prompt Draft

You will receive a set of recent messages from an ongoing conversation.

Your task is to identify the current core discussion topic and find the earliest message in the current window where this topic begins.

Return JSON with:

topic: a short description of the current topic
start_index: the earliest message index in the current window that belongs to this topic
uncertain: true or false
reason: one brief explanation

Rules:

start_index should point to the first clear appearance of the current discussion thread, not a later clarification, repetition, or extension.
If later content still revolves around the same core issue, including follow-ups, clarifications, or implementation details, it should remain part of the same topic.
Do not include a previous topic only because it is somewhat related.
If you believe the true starting point of the current topic is outside the window, set uncertain = true.
Output JSON only.
Example
Input Window
user: Should notes update every turn?
assistant: No, that would be unstable.
user: Maybe only manual trigger?
assistant: Yes, manual trigger is better for MVP.
user: But then I have a concern.
user: Ideally note generation should trace back to the topic start.
assistant: Yes, it should be based on topic boundary.
user: But I do not know how to implement that.
assistant: You can use topicId or boundary detection.
user: I prefer letting the model decide.
user: Looking back 15 messages is probably enough.
assistant: That is a workable MVP approach.
Expected Boundary Output
{
  "topic": "How to determine the starting point for note generation under the current topic",
  "start_index": 5,
  "uncertain": false,
  "reason": "Message 5 introduces a new issue: how note generation should trace back to the topic starting point. The following discussion continues around this issue."
}
Why 15 Messages

For the MVP, 15 messages is a practical heuristic default:

small enough to keep cost and latency low
large enough to cover most short topic blocks
simple to implement

This is not a theoretically perfect number. It is a reasonable default configuration.

Fallback Rule

Because 15 messages may not cover the true starting point of a longer topic, the system should include a retry rule:

First attempt: 15 messages
If uncertain = true: retry with 25 messages

For the MVP, the window should not expand indefinitely.

Save Behavior

In the MVP:

The user clicks Generate Note.
The system generates an initial note draft.
The system directly opens the editable note interface.
The user can freely revise and expand the AI-generated content.
After the user saves, the content becomes the note version for the current topic.

The note is not AI-owned output. It is AI-assisted drafting that the user continues to write and shape.

Out of Scope for MVP

The following features should not be implemented in the MVP:

automatic note updates
full-conversation topic segmentation
persistent topicId architecture
merging multiple topics into one note
background note generation
generating notes after every assistant response
separate draft/final approval workflow
Final MVP Rule

When the user clicks Generate Note, the system looks back at the most recent 15 messages, asks the model to identify the current topic and its starting point, and generates an editable note based on the content from that starting point to the latest message. The user can then revise and expand the draft, and saving it creates the note version for the current topic.