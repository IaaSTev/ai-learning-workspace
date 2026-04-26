# Highlight Follow-up Feature Spec

## 1. Goal

Enable users to highlight a span of text in an assistant message and ask a follow-up question specifically about that span.

This feature is designed for learning scenarios where users are often confused by a local phrase, sentence, or step inside a longer response, rather than the whole response.

---

## 2. Core Interaction

### Intended user flow

1. User reads an assistant response.
2. User drags the mouse to select a piece of text.
3. On mouse release, a small action button appears near the selection.
4. User clicks the button.
5. The selected text becomes highlighted in yellow.
6. A quote card containing the selected text appears above the input box.
7. The input box is focused automatically.
8. User types their follow-up question.
9. User sends the message.
10. Backend answers with awareness of:
   - the highlighted text
   - the full assistant message
   - the original user question
   - the user’s follow-up question

---

## 3. Product Principles

### 3.1 Highlight is an anchor, not the question itself

The highlighted text is only the **anchor** of the follow-up.
The actual question still comes from the user.

Example:

- Highlighted text: `XOR cannot be solved by a linear classifier`
- User question: `Why is this true? Can you explain it geometrically?`

### 3.2 Quote and question should be separated

Do **not** insert the selected text directly into the editable input body as plain text.

Instead:

- show the selected text as a **quote card / anchor chip** above the input
- let the input field contain only the user’s actual question

This keeps structure clean for both frontend and backend.

### 3.3 One active anchor only for MVP

For the first version, only allow **one active highlighted anchor at a time**.

Reason:
- simpler state management
- less ambiguity
- easier prompting
- better UX clarity

If user highlights a new span, it should replace the old active anchor.

---

## 4. MVP Scope

### Included

- Highlight text inside assistant messages
- Show floating action button after selection
- Convert selection into active yellow highlight after user confirmation
- Show quote card above input box
- Let user type follow-up question
- Send structured request to backend
- Generate response using highlight-aware context

### Not included in MVP

- Multiple simultaneous highlight anchors
- Highlighting across multiple messages
- Highlighting user messages
- Persistent visible highlight history across the whole thread
- Dedicated preset actions like “Explain”, “Example”, “Challenge”, etc.
- Mobile gesture support optimization
- Annotation sidebar / note export

---

## 5. Interaction Details

## 5.1 Selection behavior

User can highlight text by left-click dragging over assistant message text.

Valid selection requirements:
- selection must be non-empty
- selection must come from a single assistant message
- selection should not be whitespace-only

Optional guardrail:
- reject very short meaningless selections such as `it`, `this`, `they`
- or automatically expand to the containing sentence

---

## 5.2 Floating button

After mouse release, if selection is valid, show a small floating button near the selected area.

Recommended label for MVP:

`Ask about this`

Do not show many options in MVP.
One action is enough.

---

## 5.3 After clicking the button

Three things happen:

1. The selected text becomes yellow-highlighted
2. A quote card appears above the input box
3. Input box gets focus automatically

Example UI:

```text
Asking about:
“XOR cannot be solved by a linear classifier”   [x]

Why is this true? Can you show it on a 2D plot?

Where:

the quote is read-only
[x] removes the active anchor
5.4 Sending behavior

When user sends the follow-up question:

send structured data to backend
clear the active input state after successful send
optionally remove visual yellow highlight from the message after send
preserve the logical quote relationship for the sent message

Recommendation for MVP:

remove the active yellow highlight after send
keep the quote visible inside the sent follow-up message bubble or metadata

This prevents the chat transcript from becoming visually cluttered.

6. UX States
6.1 Idle state

No selection, no active anchor.

6.2 Selecting state

User is actively dragging to select text.

6.3 Selection-ready state

Selection exists and floating action button is visible.

6.4 Anchor-active state

User confirmed the selection.
The quote card is attached to the input box and the text is highlighted in yellow.

6.5 Submitted state

Question has been sent.
The active anchor is cleared from the composer.

7. UI Rules
7.1 Highlight color meaning

Use yellow highlight only for:
“this text is the active follow-up anchor currently attached to the composer.”

Do not use the same yellow style for:

generic search hits
important concepts
previously asked anchors
bookmarked notes

Color semantics must stay stable.

7.2 Quote card behavior

The quote card should be:

read-only
removable
visually distinct from the input
concise, ideally truncated if too long

Recommended behavior:

show up to 2 lines
add ellipsis if too long
full text on hover if needed
7.3 Input box behavior

The input box should contain only the user’s follow-up question.

Bad:

XOR cannot be solved by a linear classifier. Why?

Better:

Quote card: XOR cannot be solved by a linear classifier
Input: Why is this true?
8. Data Model
8.1 Frontend active anchor object
{
  "sourceMessageId": "msg_123",
  "selectedText": "XOR cannot be solved by a linear classifier",
  "startOffset": 128,
  "endOffset": 172
}
Field meanings
sourceMessageId: the assistant message where the text was selected
selectedText: the exact selected text
startOffset: start position within the source message plain text
endOffset: end position within the source message plain text
8.2 Request payload to backend
{
  "type": "highlight_followup",
  "sourceMessageId": "msg_123",
  "highlight": {
    "text": "XOR cannot be solved by a linear classifier",
    "startOffset": 128,
    "endOffset": 172
  },
  "userQuestion": "Why is this true? Can you explain it geometrically?",
  "context": {
    "originalUserQuestion": "What is the lecture trying to show with the XOR example?",
    "assistantMessage": "In this lecture, XOR cannot be solved by a linear classifier because ..."
  }
}
9. Backend Requirements

Backend should not answer based on selected text alone.

It must use at least:

highlighted text
full assistant message containing the highlight
original user question for that turn
user’s current follow-up question

Reason:
highlighted text is often ambiguous when isolated.

10. Prompting Requirements

The model should be instructed to:

identify what role the highlighted text plays in the original answer
answer the user’s follow-up specifically about that highlighted part
avoid repeating the entire previous answer unless necessary
point out if the highlighted text is imprecise, incomplete, or potentially misleading
stay anchored to the original context
Example system instruction fragment
The user highlighted a specific span from a previous assistant response and asked a follow-up question about it.

Your job:
1. Understand the highlighted span in the context of the full assistant response.
2. Answer the user’s follow-up primarily about that span.
3. Be specific and local. Do not re-explain the whole topic unless required.
4. If the highlighted span is ambiguous or slightly inaccurate, say so directly.
11. Engineering Notes
11.1 Avoid raw string-only re-highlighting

Do not rely only on text matching to restore highlight positions.
If the message is re-rendered, raw text matching may highlight the wrong span.

Prefer:

messageId
startOffset
endOffset
11.2 Markdown / rich text caution

If assistant messages are rendered from Markdown, offsets should be based on a stable plain-text representation, not raw HTML nodes.

Otherwise highlighting may drift after formatting changes.

11.3 Long selection handling

If the selected text is too long:

truncate display in the quote card
still store full text in payload
optionally warn user if selection exceeds a threshold

Suggested soft threshold:

around 200–300 characters
11.4 Clearing rules

User should be able to clear the active anchor by:

clicking [x] on the quote card
selecting a different span and confirming replacement
sending the message successfully
12. Edge Cases
12.1 Empty selection

Do nothing.

12.2 Whitespace-only selection

Do nothing.

12.3 Selection across multiple assistant messages

Reject for MVP.

12.4 Selection inside code blocks

Optional MVP decision:

either disable
or allow only plain text blocks

Recommendation:
disable in MVP unless code discussion is a primary use case.

12.5 User changes mind after activating anchor

Allow removal via [x].

12.6 User highlights a new span while one anchor is active

Show new action button.
If clicked, replace the previous active anchor.

13. Suggested MVP Acceptance Criteria

A build is acceptable if all of the following are true:

User can select text inside an assistant message.
A floating action button appears after valid selection.
Clicking the button creates one active yellow highlight.
The selected text appears as a quote card above the input box.
User can type a follow-up question separately from the quote.
Sending produces a structured backend request including:
source message id
selected text
offsets
follow-up question
The backend answer is clearly about the highlighted text, not a generic reply.
User can remove the active quote before sending.
Only one active anchor exists at a time.
After send, composer state resets correctly.
14. Future Extensions

These should wait until after MVP is stable:

multiple anchors in one follow-up
preset actions:
Explain this
Give an example
Challenge this
Simplify this
note-taking / bookmark integration
history of highlighted confusion points
highlight-based flashcard generation
support for document PDFs / notes / slides
mobile long-press interaction
analytics on which concepts are most frequently highlighted
15. Final Recommendation

For MVP, keep the design narrow:

one highlight
one button
one quote card
one follow-up input
one structured backend request

Do not overbuild annotation logic in the first version.

The feature is valuable because it changes the interaction from:

ask full question -> get full answer -> ask another full question

to:

get answer -> get stuck on one local part -> anchor it -> ask precisely

That is much closer to how real studying works.