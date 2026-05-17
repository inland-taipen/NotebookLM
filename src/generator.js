/**
 * generator.js — Answer Generation Module
 *
 * Uses Groq llama-3.3-70b-versatile.
 * Exports both a one-shot `generateAnswer` and a streaming `generateAnswerStream`.
 */

require('dotenv').config();
const Groq = require('groq-sdk');

function getGroqClient() {
  const key = process.env.GROQ_API_KEY || '';
  if (!key || key.startsWith('your_'))
    throw new Error('Missing or placeholder GROQ_API_KEY in .env');
  return new Groq({ apiKey: key });
}

const SYSTEM_PROMPT = `You are a briefing-note assistant for document Q&A.

Mission: deliver concise, executive-ready notes strictly grounded in provided chunks.

Hard constraints:
1) Use ONLY provided chunks. No outside knowledge.
2) Every substantive claim must have a citation: [Chunk N].
3) Include short supporting quotes in Evidence (not long copy-paste).
4) If evidence is partial, explicitly label uncertainty.
5) Never fabricate facts, entities, numbers, dates, or causal claims.

Required output format:
## Bottom line
1-2 sentences with the direct answer and top takeaway. Include citations.

## Key points
- 3-5 tight bullets, each <= 18 words, each with citation(s).
- Prioritize facts over commentary.

## Evidence
- Quote: "..." [Chunk N] — why it matters (very short).
- 2-4 bullets only.

## Gaps / uncertainty
- 1-3 bullets on what's missing, ambiguous, or not inferable from sources.

Style:
- Crisp, neutral, briefing-note tone.
- Prefer specific nouns/verbs; avoid fluff.
- Keep total response compact unless user asked for depth.`;

function buildUserMessage(question, contextChunks, filename) {
  const contextBlock = contextChunks
    .map((c, i) => `[Chunk ${i + 1} | Source: ${c.filename || filename} | Relevance: ${(c.score * 100).toFixed(1)}%]\n${c.text}`)
    .join('\n\n---\n\n');
  return `Document(s): "${filename}"\n\nCONTEXT FROM DOCUMENT:\n${contextBlock}\n\n---\n\nQUESTION: ${question}\n\nWrite a grounded briefing note in the exact section order requested above.\nKeep bullets tight and quote-backed in Evidence.`;
}

/**
 * One-shot answer generation.
 */
async function generateAnswer(question, contextChunks, filename = 'the document') {
  if (!contextChunks || contextChunks.length === 0) {
    return { answer: "I couldn't find any relevant content to answer your question.", model: 'none', tokensUsed: 0 };
  }
  const groq = getGroqClient();
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildUserMessage(question, contextChunks, filename) },
    ],
    temperature: 0.05,
    max_tokens:  1024,
    top_p:       0.8,
  });
  const choice = response.choices[0];
  return {
    answer:       choice.message.content,
    model:        response.model,
    tokensUsed:   response.usage?.total_tokens || 0,
    finishReason: choice.finish_reason,
  };
}

/**
 * Streaming answer generation — returns a Groq async iterable stream.
 */
async function generateAnswerStream(question, contextChunks, filename = 'the document') {
  if (!contextChunks || contextChunks.length === 0) return null;
  const groq = getGroqClient();
  return groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: buildUserMessage(question, contextChunks, filename) },
    ],
    temperature: 0.05,
    max_tokens:  1024,
    top_p:       0.8,
    stream:      true,
  });
}

module.exports = { generateAnswer, generateAnswerStream, getGroqClient };
