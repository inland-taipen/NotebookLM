/**
 * pipeline.js — RAG Pipeline Orchestrator
 *
 * Steps:
 *   1. Parse uploaded file (PDF / TXT / MD)
 *   2. Smart paragraph-aware sliding window chunking
 *   3. Gemini gemini-embedding-2 embeddings
 *   4. Persist to vector store
 *   5. Cosine similarity retrieval (single or multi-doc)
 *   6. Groq LLaMA 3.3 generation (one-shot or streaming)
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pdfParseModule = require('pdf-parse');

const { chunkTextSmart }                      = require('./chunker');
const { embedText, embedChunks }              = require('./embedder');
const vectorStore                              = require('./vectorStore');
const { generateAnswer, generateAnswerStream } = require('./generator');

// ── Ingestion ─────────────────────────────────────────────────────────────────

async function ingestDocument(filePath, docId, filename) {
  let rawText = '';
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    if (typeof pdfParseModule === 'function') {
      rawText = (await pdfParseModule(buffer)).text;
    } else if (pdfParseModule?.PDFParse) {
      const parser = new pdfParseModule.PDFParse({ data: buffer });
      try { const p = await parser.getText(); rawText = p?.text || ''; }
      finally { await parser.destroy(); }
    } else {
      throw new Error('PDF parser unavailable. Please reinstall dependencies.');
    }
    if (!rawText || rawText.trim().length < 10)
      throw new Error('PDF appears empty or image-only (no extractable text).');
  } else if (ext === '.txt' || ext === '.md') {
    rawText = fs.readFileSync(filePath, 'utf-8');
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  const chunks        = chunkTextSmart(rawText, 800, 150);
  if (chunks.length === 0) throw new Error('Document produced no usable text chunks.');

  const embeddedChunks = await embedChunks(chunks, 5);

  const metadata = {
    filename,
    ext,
    chunkCount:  embeddedChunks.length,
    charCount:   rawText.length,
    uploadedAt:  new Date().toISOString(),
    preview:     rawText.slice(0, 200).trim(),
  };

  vectorStore.saveDocument(docId, metadata, embeddedChunks);
  return { docId, filename, chunkCount: embeddedChunks.length, charCount: rawText.length, metadata };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function resolveChunks(docIds, queryEmbedding, topK) {
  const validIds = docIds.filter(id => vectorStore.hasDocument(id));
  if (validIds.length === 0) throw new Error('Document(s) not found. Please upload first.');

  const raw = validIds.length === 1
    ? vectorStore.retrieve(validIds[0], queryEmbedding, topK)
    : vectorStore.retrieveMulti(validIds, queryEmbedding, topK);

  const filtered = raw.filter(c => c.score >= 0.3);
  return { validIds, chunks: filtered.length > 0 ? filtered : raw.slice(0, 3) };
}

// ── One-shot query (used by /api/query) ───────────────────────────────────────

async function queryDocument(docId, question, topK = 5) {
  return queryDocuments([docId], question, topK);
}

async function queryDocuments(docIds, question, topK = 5) {
  const ids = Array.isArray(docIds) ? docIds : [docIds];
  const queryEmbedding = await embedText(question, 'RETRIEVAL_QUERY');
  const { validIds, chunks } = resolveChunks(ids, queryEmbedding, topK);

  const metas    = validIds.map(id => vectorStore.getDocumentMeta(id));
  const filename = metas.map(m => m.filename).join(' + ');

  const { answer, model, tokensUsed } = await generateAnswer(question, chunks, filename);
  return { answer, retrievedChunks: chunks, model, tokensUsed, docMetas: metas };
}

// ── Streaming query (used by /api/query/stream) ───────────────────────────────

async function queryDocumentsStream(docIds, question, topK = 5) {
  const ids = Array.isArray(docIds) ? docIds : [docIds];
  const queryEmbedding = await embedText(question, 'RETRIEVAL_QUERY');
  const { validIds, chunks } = resolveChunks(ids, queryEmbedding, topK);

  const metas    = validIds.map(id => vectorStore.getDocumentMeta(id));
  const filename = metas.map(m => m.filename).join(' + ');

  const stream = await generateAnswerStream(question, chunks, filename);
  return { stream, chunks, metas };
}

module.exports = { ingestDocument, queryDocument, queryDocuments, queryDocumentsStream };
