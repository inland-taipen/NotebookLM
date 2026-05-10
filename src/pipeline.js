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
// pdf-parse is lazy-loaded inside ingestDocument() to avoid
// serverless cold-start crashes (it accesses filesystem on require)

const { chunkTextSmart }                      = require('./chunker');
const { embedText, embedChunks }              = require('./embedder');
const vectorStore                              = require('./vectorStore');
const { generateAnswer, generateAnswerStream } = require('./generator');

// ── Ingestion ─────────────────────────────────────────────────────────────────

async function ingestDocument(filePath, docId, filename) {
  let rawText = '';
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.pdf') {
    // Lazy-load pdf-parse to avoid serverless cold-start crashes
    const pdfParseModule = require('pdf-parse');
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

  } else if (ext === '.doc' || ext === '.docx') {
    // Extract text from Word documents using mammoth
    const mammoth = require('mammoth');
    const result  = await mammoth.extractRawText({ path: filePath });
    rawText = result.value;
    if (!rawText || rawText.trim().length < 10)
      throw new Error('Word document appears to be empty or contains no extractable text.');

  } else if (ext === '.csv') {
    // Parse CSV — convert rows into readable key:value sentences for better RAG context
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('CSV file appears empty or has no data rows.');
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
      return headers.map((h, i) => `${h}: ${vals[i] ?? ''}`).join(' | ');
    });
    rawText = `CSV Data from "${filename}"\nColumns: ${headers.join(', ')}\n\n` + rows.join('\n');

  } else if (ext === '.txt' || ext === '.md') {
    rawText = fs.readFileSync(filePath, 'utf-8');

  } else {
    throw new Error(`Unsupported file type: ${ext}. Supported: PDF, DOC, DOCX, CSV, TXT, MD`);
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
