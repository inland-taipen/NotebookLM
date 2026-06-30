/* ─────────────────────────────────────────────────────────
   app.js  —  NotebookLLM Frontend Controller
   Features: streaming SSE, multi-doc selection, persistence
   ───────────────────────────────────────────────────────── */

const API = '';

/* ── State ─────────────────────────────────────────────── */
const state = {
  documents:    [],   // [{docId, filename, chunkCount, charCount, uploadedAt}]
  selectedIds:  new Set(),  // docIds currently checked for querying
  loading:      false,
};

/* ── DOM Refs ───────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const dropZone          = $('dropZone');
const dropZoneInner     = $('dropZoneInner');
const dropIcon          = $('dropIcon');
const dropTitle         = $('dropTitle');
const fileInput         = $('fileInput');
const btnBrowse         = $('btnBrowse');
const uploadProgress    = $('uploadProgress');
const progressBar       = $('progressBar');
const progressLabel     = $('progressLabel');
const docsList          = $('docsList');
const docsEmpty         = $('docsEmpty');
const docCount          = $('docCount');
const multiSelectToolbar = $('multiSelectToolbar');
const multiSelectLabel  = $('multiSelectLabel');
const btnSelectAll      = $('btnSelectAll');
const btnClearSel       = $('btnClearSel');
const activeQueryPill   = $('activeQueryPill');
const activeQueryLabel  = $('activeQueryLabel');
const welcomeState      = $('welcomeState');
const messagesList      = $('messagesList');
const messagesArea      = $('messagesArea');
const questionInput     = $('questionInput');
const btnSend           = $('btnSend');
const btnClearChat      = $('btnClearChat');
const btnToggleSidebar  = $('btnToggleSidebar');
const sidebar           = $('sidebar');
const suggestionsRow    = $('suggestionsRow');
const inputHint         = $('inputHint');
const studioEmpty       = $('studioEmpty');
const studioDocInfo     = $('studioDocInfo');
const studioFilenames   = $('studioFilenames');
const studioChunks      = $('studioChunks');
const studioChars       = $('studioChars');
const studioUploadedAt  = $('studioUploadedAt');
const studioDocCount    = $('studioDocCount');
const studioSources     = $('studioSources');
const studioChunksList  = $('studioChunksList');

/* ── Suggestions ────────────────────────────────────────── */
const SUGGESTIONS = [
  'What is this document about?',
  'Summarize the key points',
  'What are the main conclusions?',
  'List all important terms defined',
  'What problem does this solve?',
];

function renderSuggestions() {
  suggestionsRow.innerHTML = '';
  SUGGESTIONS.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'suggestion-chip';
    btn.textContent = s;
    btn.addEventListener('click', () => { questionInput.value = s; autoResize(); questionInput.focus(); });
    suggestionsRow.appendChild(btn);
  });
}

/* ── Sidebar Toggle ─────────────────────────────────────── */
btnToggleSidebar.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

/* ── Upload ─────────────────────────────────────────────── */
btnBrowse.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click',  () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

async function handleFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!['.pdf', '.txt', '.md', '.doc', '.docx', '.csv'].includes(ext)) {
    showToast('Supported: PDF, DOC, DOCX, CSV, TXT, MD', 'error'); return;
  }

  dropZoneInner.hidden = true;
  uploadProgress.hidden = false;
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Uploading…';

  let prog = 0;
  const tick = setInterval(() => {
    prog = Math.min(prog + Math.random() * 10, 85);
    progressBar.style.width = prog + '%';
    if (prog > 25) progressLabel.textContent = 'Chunking & embedding…';
    if (prog > 60) progressLabel.textContent = 'Storing vectors…';
  }, 400);

  const fd = new FormData();
  fd.append('document', file);

  try {
    const res  = await fetch(`${API}/api/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    clearInterval(tick);
    if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');

    progressBar.style.width = '100%';
    progressLabel.textContent = `✓ ${data.chunkCount} chunks created`;

    setTimeout(() => {
      dropZoneInner.hidden = false;
      uploadProgress.hidden = true;
    }, 2000);

    const doc = { docId: data.docId, filename: data.filename, chunkCount: data.chunkCount, charCount: data.charCount, uploadedAt: new Date().toISOString() };
    state.documents.unshift(doc);
    // Auto-select the newly uploaded doc
    state.selectedIds.add(doc.docId);
    renderDocsList();
    updateQueryUI();
    showToast(`"${file.name}" ready — ${data.chunkCount} chunks`, 'success');
    fileInput.value = '';
  } catch (err) {
    clearInterval(tick);
    dropZoneInner.hidden = false;
    uploadProgress.hidden = true;
    showToast(err.message, 'error');
    fileInput.value = '';
  }
}

/* ── Document List ──────────────────────────────────────── */
function renderDocsList() {
  docCount.textContent = state.documents.length;

  // Show/hide multi-select toolbar
  if (state.documents.length > 1) {
    multiSelectToolbar.hidden = false;
    multiSelectLabel.textContent = `${state.selectedIds.size} selected`;
  } else {
    multiSelectToolbar.hidden = true;
  }

  if (state.documents.length === 0) {
    docsEmpty.style.display = 'flex';
    // Remove all doc items
    docsList.querySelectorAll('.doc-item').forEach(el => el.remove());
    return;
  }
  docsEmpty.style.display = 'none';

  // Rebuild list
  docsList.querySelectorAll('.doc-item').forEach(el => el.remove());
  state.documents.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'doc-item' + (state.selectedIds.has(doc.docId) ? ' selected' : '');
    item.dataset.id = doc.docId;

    const icon = doc.filename.endsWith('.pdf') ? '📄'
                : doc.filename.endsWith('.csv') ? '📊'
                : (doc.filename.endsWith('.doc') || doc.filename.endsWith('.docx')) ? '📝'
                : '📃';
    const time    = new Date(doc.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const checked = state.selectedIds.has(doc.docId);

    item.innerHTML = `
      <div class="doc-checkbox ${checked ? 'checked' : ''}" data-id="${doc.docId}" role="checkbox" aria-checked="${checked}" tabindex="0" aria-label="Select ${escHtml(doc.filename)}"></div>
      <span class="doc-file-icon">${icon}</span>
      <div class="doc-info">
        <div class="doc-name" title="${escHtml(doc.filename)}">${escHtml(doc.filename)}</div>
        <div class="doc-meta">${doc.chunkCount} chunks · ${time}</div>
      </div>
      <button class="doc-delete" data-id="${doc.docId}" title="Remove" aria-label="Remove ${escHtml(doc.filename)}">
        <svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2"/></svg>
      </button>`;

    // Toggle selection on checkbox or row click
    const cb = item.querySelector('.doc-checkbox');
    const toggleSel = () => {
      if (state.selectedIds.has(doc.docId)) state.selectedIds.delete(doc.docId);
      else state.selectedIds.add(doc.docId);
      renderDocsList();
      updateQueryUI();
    };
    cb.addEventListener('click', e => { e.stopPropagation(); toggleSel(); });
    cb.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSel(); }});
    item.addEventListener('click', e => { if (!e.target.closest('.doc-delete') && !e.target.closest('.doc-checkbox')) toggleSel(); });

    item.querySelector('.doc-delete').addEventListener('click', e => { e.stopPropagation(); deleteDocument(doc.docId); });
    docsList.appendChild(item);
  });
}

async function deleteDocument(docId) {
  try {
    await fetch(`${API}/api/documents/${docId}`, { method: 'DELETE' });
    state.documents = state.documents.filter(d => d.docId !== docId);
    state.selectedIds.delete(docId);
    renderDocsList();
    updateQueryUI();
    showToast('Document removed', 'info');
  } catch { showToast('Could not delete document', 'error'); }
}

/* ── Multi-select toolbar actions ───────────────────────── */
btnSelectAll.addEventListener('click', () => {
  state.documents.forEach(d => state.selectedIds.add(d.docId));
  renderDocsList(); updateQueryUI();
});
btnClearSel.addEventListener('click', () => {
  state.selectedIds.clear();
  renderDocsList(); updateQueryUI();
});

/* ── Query UI state ─────────────────────────────────────── */
function updateQueryUI() {
  const count = state.selectedIds.size;
  const hasSelection = count > 0;

  questionInput.disabled = !hasSelection;
  questionInput.setAttribute('aria-disabled', !hasSelection);
  btnSend.disabled = !hasSelection;

  if (hasSelection) {
    const names = [...state.selectedIds].map(id => state.documents.find(d => d.docId === id)?.filename || id);
    questionInput.placeholder = count === 1 ? `Ask about ${names[0]}…` : `Ask across ${count} documents…`;
    inputHint.textContent = `Querying ${count} source${count > 1 ? 's' : ''} · Groq LLaMA 3.3 70B · Streamed`;
    activeQueryLabel.textContent = `${count} doc${count > 1 ? 's' : ''} selected`;
    activeQueryPill.hidden = false;
    renderSuggestions();
    updateStudioPanel();
    // Show welcome only if no messages
    if (messagesList.children.length === 0) {
      welcomeState.style.display = 'flex';
    }
  } else {
    questionInput.placeholder = 'Select a source to start chatting…';
    inputHint.textContent = 'Select a source above to enable chat';
    activeQueryPill.hidden = true;
    suggestionsRow.innerHTML = '';
    updateStudioPanel();
  }
}

/* ── Studio Panel ───────────────────────────────────────── */
function updateStudioPanel() {
  if (state.selectedIds.size === 0) {
    studioEmpty.hidden = false;
    studioDocInfo.hidden = true;
    return;
  }
  studioEmpty.hidden = true;
  studioDocInfo.hidden = false;

  const selected = [...state.selectedIds].map(id => state.documents.find(d => d.docId === id)).filter(Boolean);
  studioFilenames.textContent = selected.map(d => d.filename).join(', ');
  studioChunks.textContent    = selected.reduce((s, d) => s + (d.chunkCount || 0), 0).toLocaleString();
  studioChars.textContent     = selected.reduce((s, d) => s + (d.charCount  || 0), 0).toLocaleString();
  studioDocCount.textContent  = selected.length;
  const latest = selected.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  studioUploadedAt.textContent = latest ? new Date(latest.uploadedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';
}

function updateStudioChunks(chunks) {
  if (!chunks || chunks.length === 0) { studioSources.hidden = true; return; }
  studioSources.hidden = false;
  studioChunksList.innerHTML = '';
  chunks.slice(0, 5).forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'studio-chunk-item';
    el.innerHTML = `
      <div class="studio-chunk-meta">
        <span>${c.filename || 'Chunk ' + (i + 1)}</span>
        <span>${(c.score * 100).toFixed(1)}% match</span>
      </div>
      <div class="studio-chunk-text">${escHtml(c.text)}</div>`;
    studioChunksList.appendChild(el);
  });
}

/* ── Chat / Streaming ────────────────────────────────────── */
async function sendQuestion() {
  const question = questionInput.value.trim();
  if (!question || state.selectedIds.size === 0 || state.loading) return;

  state.loading = true;
  btnSend.disabled = true;
  welcomeState.style.display = 'none';
  suggestionsRow.innerHTML = '';

  appendMessage({ role: 'user', text: question, time: now() });
  questionInput.value = '';
  autoResize();

  const typingId = appendTyping();

  try {
    const modeSelect = $('modeSelect');
    const mode = modeSelect ? modeSelect.value : 'fast';

    const res = await fetch(`${API}/api/query/stream`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ docIds: [...state.selectedIds], question, topK: 5, mode }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Stream failed' }));
      throw new Error(err.error || 'Stream failed');
    }

    removeTyping(typingId);

    // Create the assistant message bubble (will be filled by stream)
    const { msgDiv, bubbleEl } = appendStreamingMessage();
    let fullText  = '';
    let chunks    = [];

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let evt;
        try {
          evt = JSON.parse(raw);
        } catch (parseErr) { continue; /* partial JSON, skip */ }

        if (evt.type === 'chunks') {
          chunks = evt.chunks || [];
          updateStudioChunks(chunks);
        } else if (evt.type === 'token') {
          fullText += evt.text;
          renderStreamingContent(bubbleEl, fullText, false);
          scrollToBottom();
        } else if (evt.type === 'done') {
          renderStreamingContent(bubbleEl, fullText, true);
          attachSourcesAccordion(msgDiv, chunks);
          addMsgTime(msgDiv);
        } else if (evt.type === 'error') {
          throw new Error(evt.error);
        }
      }
    }
  } catch (err) {
    removeTyping(typingId);
    appendErrorMsg(err.message);
  } finally {
    state.loading = false;
    btnSend.disabled = state.selectedIds.size === 0;
    questionInput.focus();
  }
}

/* ── Message rendering ──────────────────────────────────── */
function appendMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.role}`;
  const avatarHTML = msg.role === 'user'
    ? `<div class="msg-avatar">U</div>`
    : `<div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>`;
  div.innerHTML = `${avatarHTML}<div class="msg-body"><div class="msg-bubble">${formatMarkdown(msg.text)}</div><span class="msg-time">${msg.time}</span></div>`;
  messagesList.appendChild(div);
  scrollToBottom();
}

function appendStreamingMessage() {
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
    <div class="msg-body"><div class="msg-bubble"></div></div>`;
  messagesList.appendChild(div);
  scrollToBottom();
  return { msgDiv: div, bubbleEl: div.querySelector('.msg-bubble') };
}

function renderStreamingContent(bubbleEl, text, done) {
  bubbleEl.innerHTML = formatMarkdown(text) + (done ? '' : '<span class="stream-cursor"></span>');
}

function attachSourcesAccordion(msgDiv, chunks) {
  if (!chunks || chunks.length === 0) return;
  const body = msgDiv.querySelector('.msg-body');
  const wrap = document.createElement('div');
  wrap.className = 'sources-wrap';
  const chunksHTML = chunks.map((c, i) =>
    `<div class="source-chunk"><span class="source-score">Chunk ${c.index + 1} · ${c.filename || ''} · ${(c.score * 100).toFixed(1)}% match</span>${escHtml(c.text)}</div>`
  ).join('');
  wrap.innerHTML = `
    <button class="sources-toggle" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none"><polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2"/></svg>
      ${chunks.length} source chunk${chunks.length > 1 ? 's' : ''} used
    </button>
    <div class="sources-list">${chunksHTML}</div>`;
  body.insertBefore(wrap, body.querySelector('.msg-time'));
  wrap.querySelector('.sources-toggle').addEventListener('click', () => {
    const btn  = wrap.querySelector('.sources-toggle');
    const list = wrap.querySelector('.sources-list');
    const open = btn.classList.toggle('open');
    list.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
  });
}

function addMsgTime(msgDiv) {
  const existing = msgDiv.querySelector('.msg-time');
  if (!existing) {
    const t = document.createElement('span');
    t.className = 'msg-time';
    t.textContent = now();
    msgDiv.querySelector('.msg-body').appendChild(t);
  }
}

function appendTyping() {
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
    <div class="msg-body"><div class="typing-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
  messagesList.appendChild(div);
  scrollToBottom();
  return id;
}
function removeTyping(id) { const el = $(id); if (el) el.remove(); }

function appendErrorMsg(text) {
  const last = messagesList.lastElementChild;
  if (last && last.classList.contains('assistant')) {
    const bubble = last.querySelector('.msg-bubble');
    if (bubble && bubble.textContent.trim() === '') {
      last.remove();
    }
  }
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.innerHTML = `
    <div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
    <div class="msg-body"><div class="msg-error">⚠ ${escHtml(text)}</div></div>`;
  messagesList.appendChild(div);
  scrollToBottom();
}

/* ── Clear chat ─────────────────────────────────────────── */
btnClearChat.addEventListener('click', () => {
  messagesList.innerHTML = '';
  studioSources.hidden = true;
  if (state.selectedIds.size > 0) { welcomeState.style.display = 'flex'; renderSuggestions(); }
});

/* ── Helpers ────────────────────────────────────────────── */
function scrollToBottom() { requestAnimationFrame(() => messagesArea.scrollTop = messagesArea.scrollHeight); }
function now()            { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function escHtml(s)       { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function formatMarkdown(text) {
  if (typeof marked !== 'undefined') return marked.parse(text, { breaks: true });
  return escHtml(text).replace(/\n/g, '<br>');
}

function autoResize() {
  questionInput.style.height = 'auto';
  questionInput.style.height = Math.min(questionInput.scrollHeight, 150) + 'px';
}

/* ── Input events ───────────────────────────────────────── */
questionInput.addEventListener('input', autoResize);
questionInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(); }});
btnSend.addEventListener('click', sendQuestion);

/* ── Toast ──────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const tc    = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon"></span><span>${escHtml(message)}</span>`;
  tc.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3500);
}

/* ── Init ───────────────────────────────────────────────── */
(async function init() {
  try {
    const res  = await fetch(`${API}/api/documents`);
    const data = await res.json();
    if (data.documents?.length > 0) {
      state.documents = data.documents.map(d => ({
        docId:      d.docId,
        filename:   d.filename,
        chunkCount: d.chunkCount,
        charCount:  d.charCount,
        uploadedAt: d.uploadedAt,
      }));
      // Auto-select first doc
      if (state.documents[0]) state.selectedIds.add(state.documents[0].docId);
      renderDocsList();
      updateQueryUI();
    }
  } catch (_) { /* server not ready yet */ }
})();
