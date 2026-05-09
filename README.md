# NotebookLLM 📚

> A full RAG-powered document intelligence app — upload any PDF or text file and have a grounded AI conversation with it.

![NotebookLLM](https://img.shields.io/badge/RAG-Pipeline-7c6ee6?style=flat-square) ![Node.js](https://img.shields.io/badge/Node.js-Express-green?style=flat-square) ![Gemini](https://img.shields.io/badge/Embeddings-Gemini%20text--embedding--004-blue?style=flat-square) ![Groq](https://img.shields.io/badge/LLM-LLaMA%203.3%2070B-orange?style=flat-square)

---

## 🏗️ Architecture — Full RAG Pipeline

```
User uploads PDF/TXT
       │
       ▼
┌──────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│  1. PARSE    │────▶│  2. CHUNK               │────▶│  3. EMBED        │
│  pdf-parse   │     │  Smart paragraph-aware  │     │  Gemini          │
│  / fs.read   │     │  sliding window         │     │  text-embedding  │
└──────────────┘     │  (800 chars, 150 ovlp)  │     │  -004 (768-dim)  │
                     └─────────────────────────┘     └──────────────────┘
                                                              │
                                                              ▼
                                                   ┌──────────────────┐
                                                   │  4. STORE        │
                                                   │  In-memory       │
                                                   │  vector store    │
                                                   └──────────────────┘
User asks question
       │
       ▼
┌──────────────┐     ┌─────────────────────────┐     ┌──────────────────┐
│  5. RETRIEVE │◀────│  Query embedding        │     │  6. GENERATE     │
│  Top-K cosine│     │  (RETRIEVAL_QUERY)      │     │  Groq LLaMA 3.3  │
│  similarity  │────▶│                         │────▶│  70B — grounded  │
└──────────────┘     └─────────────────────────┘     │  answer only     │
                                                      └──────────────────┘
```

---

## 🧩 Chunking Strategy

**Strategy used: Smart Paragraph-Aware Sliding Window**

Implemented in `src/chunker.js` with two functions:

| Function | Description |
|---|---|
| `chunkTextSmart()` | Primary. Splits on paragraph boundaries first, then applies sliding window to paragraphs exceeding the size limit |
| `chunkText()` | Fallback. Pure sliding window at fixed character intervals |

**Parameters:**
- `chunkSize = 800` characters (~200 tokens, well within embedding model limits)
- `overlap = 150` characters (~19% overlap to preserve semantic continuity across boundaries)

**Why sliding window with overlap?**
- Sentences/ideas that span chunk boundaries are captured in at least one chunk
- Overlap prevents retrieval gaps at boundary regions
- Works well with both technical and narrative documents
- Deterministic and controllable — no ML model required for chunking

---

## 🔧 Setup

### Prerequisites
- Node.js 18+
- A **Gemini API key** (for embeddings) — [Get one here](https://aistudio.google.com/app/apikey)
- A **Groq API key** (for LLM generation) — [Get one here](https://console.groq.com)

### Installation

```bash
git clone <repo>
cd NotebookLLM
npm install
```

### Configure `.env`

```env
GEMINI_API_KEY=your_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here
PORT=3000
```

### Run

```bash
npm start
# → http://localhost:3000
```

---

## 📁 Project Structure

```
NotebookLLM/
├── server.js           # Express API server
├── src/
│   ├── pipeline.js     # RAG orchestrator (steps 1-6)
│   ├── chunker.js      # Chunking strategies (documented)
│   ├── embedder.js     # Gemini text-embedding-004
│   ├── vectorStore.js  # In-memory cosine similarity DB
│   └── generator.js    # Groq LLaMA 3.3 answer generation
├── public/
│   ├── index.html      # Web UI
│   ├── style.css       # Dark glassmorphism design
│   └── app.js          # Frontend controller
├── uploads/            # Temp uploaded files (auto-created)
└── .env                # API keys
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload + ingest a document |
| `POST` | `/api/query` | Ask a question about a document |
| `GET` | `/api/documents` | List all loaded documents |
| `DELETE` | `/api/documents/:docId` | Remove a document |
| `GET` | `/api/health` | Health check |

---

## ✅ Requirements Checklist

- [x] Upload PDF or plain text files
- [x] Chunking strategy implemented and documented (sliding window + paragraph-aware)
- [x] Vector database used (in-memory cosine similarity store)
- [x] Embeddings via Gemini text-embedding-004
- [x] LLM uses retrieved context to answer (strict system prompt)
- [x] Answers grounded in document — not LLM training memory
- [x] Handles documents never seen before
- [x] Working web UI with real-time chat interface
