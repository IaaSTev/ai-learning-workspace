/**
 * Detect when the user asks for answers grounded in lecture/slide/document text.
 */

export function isDocumentFirstQuery(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t) return false;

  return (
    /(?:讲义|文档|slide|幻灯)[\s\S]{0,16}里/i.test(t) ||
    /根据[\s\S]{0,8}课件/.test(t) ||
    /文档[\s\S]{0,12}(有没有|是否)[\s\S]{0,8}提到/.test(t) ||
    /课件[\s\S]{0,12}(怎么|如何|说)/.test(t) ||
    /这份(讲义|文档|课件|材料)/.test(t)
  );
}

/**
 * Extra system instructions when the user's question clearly asks what the
 * lecture/slide/document says. Not used for normal Q&A — keep the default assistant tone there.
 */
export function documentFirstModeSystemRules(): string {
  return `

## Document-first mode (this user turn only)

The user is asking what the lecture materials / slides / document say. Apply the rules below for this reply only. Do not use a rigid template; keep wording natural.

How to answer:
1. First, answer using only what is supported by the "Retrieved materials" above (quote or paraphrase). If the passages are empty or silent on the point, say clearly that the materials do not address it — do not invent document content.
2. Clearly state whether the question is explicitly covered in those materials (e.g. whether it is clearly mentioned, partially, or not).
3. If you add general knowledge not stated in the retrieved passages, put it in a separate short block that starts with the exact line "额外补充：" on its own, then the supplement. Do not blend outside knowledge into sentences that sound like they come from the document.
4. If no outside supplement is needed, omit the "额外补充：" block entirely — no filler.

If the materials do not mention the topic but it is conceptually related, say first that the document does not clearly mention it, then you may add a brief related note under "额外补充：".

Tone: conversational and clear, not robotic or checklist-like.`;
}
