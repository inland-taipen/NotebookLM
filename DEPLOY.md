# Deployment Guide — NotebookLLM

## Step 1 — Push to GitHub

1. Go to https://github.com/new
2. Name: `NotebookLLM` | Public | NO README/gitignore
3. Click **Create repository**
4. Copy the HTTPS URL (e.g. `https://github.com/YOUR_USERNAME/NotebookLLM.git`)
5. Run these commands (replace URL with yours):

```bash
git remote add origin https://github.com/YOUR_USERNAME/NotebookLLM.git
git branch -M main
git push -u origin main
```

## Step 2 — Deploy to Railway

Railway is the best fit: supports Node.js, SSE streaming, persistent disk, free $5/month credit.

1. Go to https://railway.app → **Login with GitHub**
2. Click **+ New Project** → **Deploy from GitHub repo**
3. Select `NotebookLLM`
4. Railway auto-detects Node.js and runs `npm start`

### Set environment variables

In Railway dashboard → your service → **Variables** tab, add:

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | Your Gemini API key |
| `GROQ_API_KEY` | Your Groq API key |
| `PORT` | `3000` (Railway sets this automatically, optional) |

### Get your public URL

Railway dashboard → **Settings** → **Domains** → click **Generate Domain**  
Your app will be live at: `https://notebookllm-xxxx.up.railway.app`

---

## Alternative — Render

1. Go to https://render.com → **New** → **Web Service**
2. Connect GitHub → select `NotebookLLM`
3. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
4. Add environment variables (same as above)

> ⚠️ Render free tier spins down after 15 min inactivity (first request is slow).

---

## Notes on Persistence

The vector store saves to `data/vector_store.json`. On Railway this **persists** between deployments on the same instance. On Render free tier, the disk resets on spin-down.

For production persistence, consider upgrading to Railway Pro (persistent volumes) or Render Disk ($1/GB/month).
