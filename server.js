/**
 * server.js — Express API Server
 *
 * REST endpoints:
 *   POST /api/upload              — Upload + ingest a document (PDF / TXT / MD)
 *   POST /api/query               — One-shot Q&A (single or multi-doc)
 *   POST /api/query/stream        — SSE streaming Q&A (single or multi-doc)
 *   GET  /api/documents           — List all loaded documents
 *   DELETE /api/documents/:docId  — Remove a document
 *   GET  /api/health              — Health check
 */

require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { randomUUID: uuidv4 } = require('crypto'); // built-in, no ESM issues

const { ingestDocument, queryDocument, queryDocuments, queryDocumentsStream } = require('./src/pipeline');
const vectorStore = require('./src/vectorStore');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── File Upload Config ────────────────────────────────────────────────────────
// Vercel serverless only allows writes to /tmp; use it when VERCEL env is set
const UPLOAD_DIR = process.env.VERCEL ? '/tmp/nlm-uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error('Only PDF, TXT, and MD files are allowed.'));
  },
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', message: 'NotebookLLM API is running', timestamp: new Date().toISOString() })
);

// ── Upload ────────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const docId    = uuidv4();
  const filePath = req.file.path;
  const filename = req.file.originalname;

  try {
    console.log(`[UPLOAD] Processing: ${filename}`);
    const result = await ingestDocument(filePath, docId, filename);
    console.log(`[UPLOAD] ✓ "${filename}" → ${result.chunkCount} chunks`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({
      success:    true,
      docId:      result.docId,
      filename:   result.filename,
      chunkCount: result.chunkCount,
      charCount:  result.charCount,
      message:    `Processed into ${result.chunkCount} chunks.`,
    });
  } catch (err) {
    console.error(`[UPLOAD] Error: ${err.message}`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const msg = String(err.message || '');
    const isRateLimit = msg.includes('429') || msg.includes('Quota exceeded') || msg.includes('rate limit');
    if (isRateLimit)
      return res.status(429).json({ error: 'Embedding quota/rate limit reached. Wait a minute and retry.' });

    res.status(500).json({ error: err.message });
  }
});

// ── One-shot Query (single or multi-doc) ─────────────────────────────────────
app.post('/api/query', async (req, res) => {
  const { docId, docIds: rawDocIds, question, topK = 5 } = req.body;
  const docIds = rawDocIds || (docId ? [docId] : []);

  if (!docIds.length) return res.status(400).json({ error: 'docId or docIds required.' });
  if (!question?.trim()) return res.status(400).json({ error: 'question is required.' });

  try {
    console.log(`[QUERY] docs=${docIds.join(',')} | q="${question.slice(0, 80)}"`);
    const result = await queryDocuments(docIds, question.trim(), topK);
    console.log(`[QUERY] ✓ ${result.tokensUsed} tokens`);

    res.json({
      success:    true,
      answer:     result.answer,
      model:      result.model,
      tokensUsed: result.tokensUsed,
      chunks:     result.retrievedChunks.map(c => ({
        text:     c.text.slice(0, 300) + (c.text.length > 300 ? '...' : ''),
        score:    parseFloat(c.score.toFixed(4)),
        index:    c.index,
        filename: c.filename,
      })),
      docMetas: result.docMetas,
    });
  } catch (err) {
    console.error(`[QUERY] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Streaming Query (SSE) ─────────────────────────────────────────────────────
app.post('/api/query/stream', async (req, res) => {
  const { docId, docIds: rawDocIds, question, topK = 5 } = req.body;
  const docIds = rawDocIds || (docId ? [docId] : []);

  if (!docIds.length) return res.status(400).json({ error: 'docId or docIds required.' });
  if (!question?.trim()) return res.status(400).json({ error: 'question is required.' });

  // SSE headers
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const send = obj => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    console.log(`[STREAM] docs=${docIds.join(',')} | q="${question.slice(0, 80)}"`);
    const { stream, chunks, metas } = await queryDocumentsStream(docIds, question.trim(), topK);

    // Send retrieved chunks metadata first so the frontend can show sources immediately
    send({
      type: 'chunks',
      chunks: chunks.map(c => ({
        text:     c.text.slice(0, 300) + (c.text.length > 300 ? '...' : ''),
        score:    parseFloat(c.score.toFixed(4)),
        index:    c.index,
        filename: c.filename,
      })),
      docMetas: metas,
    });

    if (!stream) {
      send({ type: 'error', error: "No relevant content found in document(s)." });
      return res.end();
    }

    let totalTokens = 0;
    let model = 'llama-3.3-70b-versatile';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) send({ type: 'token', text: delta });
      if (chunk.usage) {
        totalTokens = chunk.usage.total_tokens;
        model = chunk.model || model;
      }
    }

    send({ type: 'done', model, tokensUsed: totalTokens });
    console.log(`[STREAM] ✓ done`);
    res.end();
  } catch (err) {
    console.error(`[STREAM] Error: ${err.message}`);
    send({ type: 'error', error: err.message });
    res.end();
  }
});

// ── Document list ─────────────────────────────────────────────────────────────
app.get('/api/documents', (req, res) =>
  res.json({ documents: vectorStore.listDocuments() })
);

// ── Delete document ───────────────────────────────────────────────────────────
app.delete('/api/documents/:docId', (req, res) => {
  const { docId } = req.params;
  if (!vectorStore.hasDocument(docId))
    return res.status(404).json({ error: 'Document not found.' });
  vectorStore.deleteDocument(docId);
  res.json({ success: true, message: 'Document removed.' });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

// ── Start (skip in Vercel serverless — it manages the port itself) ───────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🚀 NotebookLLM server running at http://localhost:${PORT}`);
    console.log(`   Upload documents and start chatting!\n`);
  });
}

module.exports = app;
