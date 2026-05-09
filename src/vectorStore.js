/**
 * vectorStore.js — Persistent In-Memory Vector Database
 *
 * Now persists to data/vector_store.json so documents survive server restarts.
 * Also supports multi-document retrieval for cross-doc queries.
 */

const fs   = require('fs');
const path = require('path');
const { cosineSimilarity } = require('./embedder');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const STORE_PATH  = path.join(DATA_DIR, 'vector_store.json');
const IS_VERCEL   = !!process.env.VERCEL; // Vercel has no writable project dir

// In-memory store: Map<docId, { metadata, chunks }>
const store = new Map();

// ── Persistence ──────────────────────────────────────────────────────────────

function loadFromDisk() {
  if (IS_VERCEL) return; // Serverless: no persistent disk
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      let count = 0;
      for (const [docId, doc] of Object.entries(data)) {
        store.set(docId, doc);
        count++;
      }
      if (count > 0) console.log(`[STORE] ✓ Loaded ${count} document(s) from disk`);
    }
  } catch (err) {
    console.warn(`[STORE] Could not load from disk: ${err.message}`);
  }
}

function saveToDisk() {
  if (IS_VERCEL) return; // Serverless: in-memory only
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const data = {};
    for (const [docId, doc] of store.entries()) data[docId] = doc;
    fs.writeFileSync(STORE_PATH, JSON.stringify(data));
  } catch (err) {
    console.warn(`[STORE] Could not save to disk: ${err.message}`);
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function saveDocument(docId, metadata, chunks) {
  store.set(docId, { metadata, chunks });
  saveToDisk();
}

function hasDocument(docId) { return store.has(docId); }

function getDocumentMeta(docId) {
  const doc = store.get(docId);
  return doc ? doc.metadata : null;
}

function listDocuments() {
  const docs = [];
  for (const [docId, { metadata }] of store.entries())
    docs.push({ docId, ...metadata });
  return docs;
}

function deleteDocument(docId) {
  store.delete(docId);
  saveToDisk();
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

/** Top-K from a single document. */
function retrieve(docId, queryVec, topK = 5) {
  const doc = store.get(docId);
  if (!doc) throw new Error(`Document "${docId}" not found in vector store.`);
  return doc.chunks
    .map(chunk => ({
      text:     chunk.text,
      index:    chunk.index,
      docId,
      filename: doc.metadata.filename,
      score:    cosineSimilarity(queryVec, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Top-K across multiple documents (for multi-doc chat). */
function retrieveMulti(docIds, queryVec, topK = 5) {
  const all = [];
  for (const docId of docIds) {
    const doc = store.get(docId);
    if (!doc) continue;
    for (const chunk of doc.chunks)
      all.push({
        text:     chunk.text,
        index:    chunk.index,
        docId,
        filename: doc.metadata.filename,
        score:    cosineSimilarity(queryVec, chunk.embedding),
      });
  }
  return all.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadFromDisk();

module.exports = { saveDocument, hasDocument, getDocumentMeta, listDocuments, deleteDocument, retrieve, retrieveMulti };
