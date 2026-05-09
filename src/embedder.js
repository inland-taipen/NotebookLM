/**
 * embedder.js — Embedding Module
 *
 * Embedding strategy (provider order):
 *   1) Gemini embeddings (gemini-embedding-2)
 *   2) Local deterministic hash embeddings (no external API dependency)
 *
 * We compute cosine
 * similarity between the query embedding and stored chunk embeddings
 * to retrieve the most semantically relevant chunks.
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

let warnedLocalFallback = false;

function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key || key.startsWith('your_')) return null;
  return new GoogleGenerativeAI(key);
}

function localHashEmbedding(text, dim = 512) {
  const vec = new Array(dim).fill(0);
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  if (norm > 0) {
    norm = Math.sqrt(norm);
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * Generate an embedding vector for a single piece of text.
 * @param {string} text - The text to embed
 * @param {string} taskType - 'RETRIEVAL_DOCUMENT' or 'RETRIEVAL_QUERY'
 * @returns {Promise<number[]>} embedding vector
 */
async function embedText(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const gemini = getGeminiClient();

  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({ model: 'gemini-embedding-2' });
      const result = await model.embedContent({
        content: { role: 'user', parts: [{ text }] },
        taskType: taskType,
      });
      const emb = result.embedding.values;
      if (Array.isArray(emb) && emb.length > 0) return emb;
    } catch (err) {
      if (!warnedLocalFallback) {
        warnedLocalFallback = true;
        console.warn(`[EMBEDDER] Gemini embedding unavailable, falling back to local embeddings: ${err.message}`);
      }
    }
  } else if (!warnedLocalFallback) {
    warnedLocalFallback = true;
    console.warn('[EMBEDDER] GEMINI_API_KEY missing/placeholder; falling back to local embeddings.');
  }

  // Local fallback keeps uploads and retrieval working without external embedding quota.
  return localHashEmbedding(text);
}

/**
 * Embed an array of chunks in batches to respect API rate limits.
 * @param {Array<{text: string, index: number}>} chunks
 * @param {number} batchSize - Number of chunks per batch
 * @returns {Promise<Array<{text, index, embedding}>>}
 */
async function embedChunks(chunks, batchSize = 5) {
  const embedded = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        const embedding = await embedText(chunk.text, 'RETRIEVAL_DOCUMENT');
        return { ...chunk, embedding };
      })
    );

    embedded.push(...batchResults);

    // Brief pause between batches to avoid rate limiting
    if (i + batchSize < chunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return embedded;
}

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} similarity score in [-1, 1], higher = more similar
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { embedText, embedChunks, cosineSimilarity };
