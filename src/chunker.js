/**
 * chunker.js — Document Chunking Module
 *
 * Chunking Strategy: Sliding Window with Overlap
 * -----------------------------------------------
 * The text is split into fixed-size chunks of `chunkSize` characters.
 * Each consecutive chunk overlaps with the previous one by `overlap` characters.
 * This ensures that sentences/ideas that span chunk boundaries are still
 * captured in at least one chunk, preventing retrieval gaps.
 *
 * Example:
 *   Text: "ABCDEFGHIJ" | chunkSize=4, overlap=2
 *   Chunks: ["ABCD", "CDEF", "EFGH", "GHIJ"]
 *
 * Why sliding window?
 *   - Simple and deterministic (no ML model required)
 *   - Overlap preserves semantic continuity across boundaries
 *   - Works well with dense technical or narrative documents
 *   - Controllable chunk sizes match embedding model token limits
 *
 * Parameters (defaults):
 *   chunkSize : 800  characters  (~200 tokens, well within embedding limits)
 *   overlap   : 150  characters  (~19% overlap for continuity)
 */

/**
 * Split text into overlapping chunks.
 * @param {string} text      - Raw document text
 * @param {number} chunkSize - Max characters per chunk (default 800)
 * @param {number} overlap   - Overlap characters between chunks (default 150)
 * @returns {Array<{text: string, index: number, charStart: number, charEnd: number}>}
 */
function chunkText(text, chunkSize = 800, overlap = 150) {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot chunk empty text.');
  }

  // Normalize whitespace: collapse multiple newlines into double newlines
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const chunks = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunkText = normalized.slice(start, end);

    // Only add non-trivial chunks (avoid whitespace-only chunks)
    if (chunkText.trim().length > 20) {
      chunks.push({
        text: chunkText.trim(),
        index,
        charStart: start,
        charEnd: end,
      });
      index++;
    }

    // Advance by (chunkSize - overlap), but stop if we're at the end
    const step = chunkSize - overlap;
    if (start + chunkSize >= normalized.length) break;
    start += step;
  }

  return chunks;
}

/**
 * Smart paragraph-aware chunking — splits on paragraph boundaries first,
 * then applies sliding window to any paragraph that exceeds chunkSize.
 * This is used as the primary strategy to preserve natural text structure.
 *
 * @param {string} text      - Raw document text
 * @param {number} chunkSize - Target max chunk size in characters
 * @param {number} overlap   - Overlap in characters when splitting long paragraphs
 * @returns {Array<{text: string, index: number}>}
 */
function chunkTextSmart(text, chunkSize = 800, overlap = 150) {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot chunk empty text.');
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  
  // Split on double newlines (paragraph boundaries)
  const paragraphs = normalized.split(/\n\n+/).filter(p => p.trim().length > 20);

  const chunks = [];
  let index = 0;
  let buffer = '';

  for (const para of paragraphs) {
    // If adding this paragraph stays within chunkSize, accumulate
    if (buffer.length + para.length + 2 <= chunkSize) {
      buffer = buffer ? buffer + '\n\n' + para : para;
    } else {
      // Flush the buffer as a chunk
      if (buffer.trim().length > 20) {
        chunks.push({ text: buffer.trim(), index: index++ });
      }
      
      // If the paragraph itself is larger than chunkSize, apply sliding window
      if (para.length > chunkSize) {
        const subChunks = chunkText(para, chunkSize, overlap);
        for (const sc of subChunks) {
          chunks.push({ text: sc.text, index: index++ });
        }
        buffer = '';
      } else {
        buffer = para;
      }
    }
  }

  // Flush remaining buffer
  if (buffer.trim().length > 20) {
    chunks.push({ text: buffer.trim(), index: index++ });
  }

  return chunks;
}

module.exports = { chunkText, chunkTextSmart };
