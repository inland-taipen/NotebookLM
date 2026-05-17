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

---

## 🚀 Advanced RAG Implementations (Bottlenecks)

This project implements several advanced techniques to resolve common bottlenecks in RAG applications:

### 1. Tradeoff between speed and accuracy
We introduced a `mode` parameter in our querying pipeline (`fast` vs `accurate`), accessible via the UI dropdown. 
- **Fast Mode**: Uses a smaller `topK` (3), skips query rewriting, skips HyDE, skips LLM re-ranking, and has a smaller context token limit. Ensures sub-second retrieval.
- **Accurate Mode**: Uses a larger `topK` (10), enables semantic query rewriting or Corrective RAG (HyDE) for better recall, re-ranks chunks using an LLM cross-encoder, and includes an LLM judge for evaluation.

### 2. Query Rewriting using SLMs | Query Translation
Implemented in `src/advancedRag.js`. We use the LLM to translate the user's initial query into 1-3 distinct, highly specific search queries. This helps overcome the vocabulary mismatch problem between the user's question and the document's terminology.

### 3. LLM Judges
After generation in Accurate mode, an LLM Judge evaluates whether the generated answer is strictly grounded in the retrieved context chunks. It returns a JSON object containing a boolean `grounded` flag and a `reason`.

### 4. Sub Query Enhancement
Also handled by query rewriting. By prompting the LLM to break the question into distinct search queries, we enhance the retrieval process by covering multiple facets of a complex question.

### 5. Corrective RAG | HYDE Principal
Instead of embedding the user's question directly, we first ask the LLM to generate a hypothetical answer. We concatenate the original question and the hypothetical answer, embed it, and use that rich embedding to search the vector store. This drastically improves semantic similarity search.

### 6. Re-ranking Strategies (Cross-Encoders)
Since a standard cosine similarity search might retrieve chunks that share keywords but lack contextual relevance, we retrieve a larger pool of chunks and pass them to the LLM acting as a cross-encoder. The LLM rates each chunk from 0 to 10, and we re-sort the chunks based on these scores.

### 7. Context Window & Token Bottlenecks
LLMs have limited context windows and charge per token. We implemented a dynamic chunk truncation strategy that estimates token count (~4 characters per token) and drops lower-ranked chunks if they exceed a configurable `maxTokens` limit.

### 8. Chunk Size & Overlap Tradeoffs
Managed in `src/chunker.js`. Our sliding window chunker exposes `chunkSize` and `overlap` parameters, defaulting to a hybrid paragraph-aware chunking strategy that balances semantic boundaries with context preservation.
