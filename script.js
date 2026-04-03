/**
 * ================================================================
 *  script.js — NeuralChat · Local AI Interface
 *  Full multi-session: switch, rename, delete, restore messages
 * ================================================================
 */

'use strict';

/* ================================================================
   1.  CONFIGURATION
   ================================================================ */
const CONFIG = {
  API_URL    : 'http://127.0.0.1:5001/chat',   // ← غيّر هنا
  API_METHOD : 'POST',

  buildRequestBody(message, history) {
    return JSON.stringify({ message, history });
  },

  extractReply(data) {
    return data.reply
      ?? data?.choices?.[0]?.message?.content
      ?? data?.response
      ?? 'No response received.';
  },

  AI_NAME  : 'NeuralChat',
  USER_NAME: 'You',
};


/* ================================================================
   2.  DOM REFERENCES
   ================================================================ */
const chatFeed         = document.getElementById('chatFeed');
const userInput        = document.getElementById('userInput');
const btnSend          = document.getElementById('btnSend');
const typingWrapper    = document.getElementById('typingWrapper');
const emptyState       = document.getElementById('emptyState');
const historyList      = document.getElementById('historyList');
const chatTitle        = document.getElementById('chatTitle');
const statusPill       = document.getElementById('statusPill');
const statusText       = statusPill.querySelector('.status-pill__text');
const btnNewChat       = document.getElementById('btnNewChat');
const btnSidebarToggle = document.getElementById('btnSidebarToggle');
const sidebar          = document.getElementById('sidebar');
const suggestionChips  = document.getElementById('suggestionChips');


/* ================================================================
   3.  SESSION STORE
   ================================================================
   sessions[] — each entry:
   {
     id        : string            unique ID
     label     : string            sidebar title
     history   : [{role,content}]  API context array
     messages  : [{role,content,time}]  full UI messages
     createdAt : number
     _scrollTop: number            saved scroll position
   }
   ================================================================ */
let sessions  = [];
let activeId  = null;
let isLoading = false;


/* ================================================================
   4.  UTILITIES
   ================================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderMarkdown(text) {
  let h = escapeHTML(text);
  h = h.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  h = h.replace(/`([^`]+)`/g,    '<code>$1</code>');
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/__(.+?)__/g,    '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g,    '<em>$1</em>');
  h = h.replace(/_(.+?)_/g,      '<em>$1</em>');
  h = h.replace(/^[•\-]\s+(.+)$/gm,'<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>)/g,'<ul>$1</ul>');
  h = h.replace(/^\d+\.\s+(.+)$/gm,'<li>$1</li>');
  h = h.replace(/\n\n/g,'</p><p>');
  h = h.replace(/\n/g,'<br>');
  return `<p>${h}</p>`;
}

function scrollToBottom() {
  chatFeed.scrollTo({ top: chatFeed.scrollHeight, behavior: 'smooth' });
}

function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
}

function updateSendButton() {
  btnSend.disabled = !userInput.value.trim() || isLoading;
}


/* ================================================================
   5.  STATUS PILL
   ================================================================ */
function setStatus(state, label) {
  statusPill.classList.remove('status-pill--error','status-pill--thinking');
  if      (state === 'thinking') { statusPill.classList.add('status-pill--thinking'); statusText.textContent = label ?? 'Thinking...'; }
  else if (state === 'error')    { statusPill.classList.add('status-pill--error');    statusText.textContent = label ?? 'Error'; }
  else                           { statusText.textContent = label ?? 'Ready'; }
}


/* ================================================================
   6.  MESSAGE BUILDER
       buildMessageEl — pure DOM, no side-effects.
       appendMessage  — builds + appends + saves to session.
   ================================================================ */
function buildMessageEl(role, content, time) {
  const group = document.createElement('div');
  group.classList.add('message-group');
  if      (role === 'user')  group.classList.add('message-group--user');
  else if (role === 'error') group.classList.add('message-group--error');
  else                       group.classList.add('message-group--ai');

  if (role === 'ai') {
    const header = document.createElement('div');
    header.classList.add('message-header');
    header.innerHTML = `
      <div class="message-avatar" aria-hidden="true">AI</div>
      <span class="message-sender">${CONFIG.AI_NAME}</span>`;
    group.appendChild(header);
  }

  const bubble = document.createElement('div');
  bubble.classList.add('message-bubble');
  bubble.setAttribute('role','article');
  bubble.innerHTML = role === 'user'
    ? escapeHTML(content).replace(/\n/g,'<br>')
    : renderMarkdown(content);
  group.appendChild(bubble);

  const ts = document.createElement('span');
  ts.classList.add('message-time');
  ts.textContent = time ?? getTimestamp();
  group.appendChild(ts);

  return group;
}

function appendMessage(role, content) {
  // Hide empty state
  if (emptyState && !emptyState.hidden) {
    emptyState.style.opacity   = '0';
    emptyState.style.transform = 'translateY(-8px)';
    setTimeout(() => { emptyState.hidden = true; }, 200);
  }

  const time = getTimestamp();
  const el   = buildMessageEl(role, content, time);
  chatFeed.appendChild(el);
  scrollToBottom();

  // Persist in active session
  const session = sessions.find(s => s.id === activeId);
  if (session) session.messages.push({ role, content, time });

  return el;
}


/* ================================================================
   7.  TYPING INDICATOR
   ================================================================ */
function showTyping() {
  typingWrapper.style.display = 'block';
  typingWrapper.setAttribute('aria-hidden','false');
  scrollToBottom();
}

function hideTyping() {
  typingWrapper.style.display = 'none';
  typingWrapper.setAttribute('aria-hidden','true');
}


/* ================================================================
   8.  SIDEBAR — sessions list
   ================================================================ */

/** Re-render the entire sidebar list */
function renderSidebar() {
  historyList.innerHTML = '';

  if (sessions.length === 0) {
    historyList.innerHTML = `
      <li style="padding:10px 8px;font-size:var(--text-xs);
                 color:var(--text-muted);font-family:var(--font-mono);">
        No conversations yet
      </li>`;
    return;
  }

  // newest first
  [...sessions].reverse().forEach(s => {
    historyList.appendChild(buildSidebarItem(s));
  });
}

/** Build one <li> for a session with 3 inner states */
function buildSidebarItem(session) {
  const li = document.createElement('li');
  li.classList.add('history-item');
  li.dataset.id = session.id;
  if (session.id === activeId) li.classList.add('history-item--active');

  /* ── VIEW ── */
  function renderView() {
    li.classList.remove('history-item--confirm-delete');
    li.innerHTML = `
      <svg class="history-item__icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 3.686 3.686 1 7 1s6 2.686 6 6-2.686 6-6 6H1l2-2"
              stroke="currentColor" stroke-width="1.3"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="history-item__label" title="${escapeHTML(session.label)}">
        ${escapeHTML(session.label)}
      </span>
      <div class="history-item__actions">
        <button class="history-item__btn btn-rename" title="Rename" aria-label="Rename">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor"
                  stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="history-item__btn history-item__btn--delete btn-delete" title="Delete" aria-label="Delete">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 3.5h9M5 3.5V2h3v1.5M10.5 3.5l-.7 7H3.2l-.7-7"
                  stroke="currentColor" stroke-width="1.3"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>`;

    // Switch session on click
    li.addEventListener('click', e => {
      if (e.target.closest('.history-item__actions')) return;
      switchToSession(session.id);
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('sidebar--open');
        btnSidebarToggle.setAttribute('aria-expanded','false');
      }
    });

    li.querySelector('.btn-rename').addEventListener('click', e => {
      e.stopPropagation(); renderRename();
    });
    li.querySelector('.btn-delete').addEventListener('click', e => {
      e.stopPropagation(); renderDeleteConfirm();
    });
  }

  /* ── RENAME ── */
  function renderRename() {
    li.innerHTML = `
      <svg class="history-item__icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 7C1 3.686 3.686 1 7 1s6 2.686 6 6-2.686 6-6 6H1l2-2"
              stroke="currentColor" stroke-width="1.3"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <input class="history-item__rename-input" type="text"
             value="${escapeHTML(session.label)}"
             maxlength="60" aria-label="Rename conversation"/>
      <div class="history-item__rename-actions">
        <button class="history-item__btn history-item__btn--confirm btn-ok" title="Save">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 6.5l3.5 3.5 5.5-6" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="history-item__btn history-item__btn--cancel btn-cancel" title="Cancel">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>`;

    const input = li.querySelector('.history-item__rename-input');
    input.focus(); input.select();

    function doSave() {
      const v = input.value.trim();
      if (v) {
        session.label = v;
        if (session.id === activeId) chatTitle.textContent = v;
      }
      renderView();
    }

    li.querySelector('.btn-ok').addEventListener('click', e => { e.stopPropagation(); doSave(); });
    li.querySelector('.btn-cancel').addEventListener('click', e => { e.stopPropagation(); renderView(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') { e.preventDefault(); renderView(); }
      e.stopPropagation();
    });
  }

  /* ── DELETE CONFIRM ── */
  function renderDeleteConfirm() {
    li.classList.add('history-item--confirm-delete');
    li.innerHTML = `
      <div class="delete-confirm-bar">
        <span>Delete this chat?</span>
        <button class="btn-confirm-yes">Delete</button>
        <button class="btn-confirm-no">Cancel</button>
      </div>`;

    li.querySelector('.btn-confirm-yes').addEventListener('click', e => {
      e.stopPropagation(); deleteSession(session.id);
    });
    li.querySelector('.btn-confirm-no').addEventListener('click', e => {
      e.stopPropagation();
      li.classList.remove('history-item--confirm-delete');
      renderView();
    });
  }

  renderView();
  return li;
}


/* ================================================================
   9.  SESSION OPERATIONS
   ================================================================ */

/** Create a new session, make it active, re-render sidebar */
function createSession(label) {
  const session = {
    id       : uid(),
    label,
    history  : [],
    messages : [],
    createdAt: Date.now(),
    _scrollTop: null,
  };
  sessions.push(session);
  activeId = session.id;
  renderSidebar();
  return session;
}

/**
 * Switch the feed to an existing session.
 * Saves scroll of current, clears feed, re-renders saved messages.
 */
function switchToSession(id) {
  if (id === activeId) return;

  // Save scroll of current session
  const cur = sessions.find(s => s.id === activeId);
  if (cur) cur._scrollTop = chatFeed.scrollTop;

  activeId = id;
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  // Update header
  chatTitle.textContent = session.label;
  setStatus('ready');
  hideTyping();

  // Clear feed
  chatFeed.querySelectorAll('.message-group').forEach(el => el.remove());

  if (session.messages.length === 0) {
    // Empty session — show landing
    if (emptyState) {
      emptyState.hidden      = false;
      emptyState.style.opacity   = '';
      emptyState.style.transform = '';
    }
  } else {
    // Restore messages instantly (no animation)
    if (emptyState) emptyState.hidden = true;

    session.messages.forEach(msg => {
      const el = buildMessageEl(msg.role, msg.content, msg.time);
      el.style.animation = 'none';
      chatFeed.appendChild(el);
    });

    // Restore scroll
    requestAnimationFrame(() => {
      chatFeed.scrollTop = session._scrollTop ?? chatFeed.scrollHeight;
    });
  }

  // Update sidebar highlight
  document.querySelectorAll('.history-item').forEach(el => {
    el.classList.toggle('history-item--active', el.dataset.id === id);
  });

  // Reset input
  userInput.value        = '';
  userInput.style.height = 'auto';
  updateSendButton();
  userInput.focus();
}

/** Delete a session and reset UI if it was active */
function deleteSession(id) {
  const idx = sessions.findIndex(s => s.id === id);
  if (idx === -1) return;
  sessions.splice(idx, 1);

  if (activeId === id) {
    activeId = null;
    chatFeed.querySelectorAll('.message-group').forEach(el => el.remove());
    if (emptyState) {
      emptyState.hidden      = false;
      emptyState.style.opacity   = '';
      emptyState.style.transform = '';
    }
    chatTitle.textContent = 'New Conversation';
    setStatus('ready');
    hideTyping();
    userInput.value        = '';
    userInput.style.height = 'auto';
    isLoading              = false;
    updateSendButton();
    userInput.focus();
  }

  renderSidebar();
}


/* ================================================================
   10. CORE: sendMessage()
   ================================================================ */
async function sendMessage() {
  if (isLoading) return;

  const rawInput = userInput.value.trim();
  if (!rawInput) return;

  isLoading = true;
  btnSend.disabled   = true;
  userInput.disabled = true;
  setStatus('thinking');

  // Auto-create session on first message
  let session = sessions.find(s => s.id === activeId);
  if (!session) {
    const label = rawInput.length > 40 ? rawInput.slice(0, 40) + '…' : rawInput;
    session = createSession(label);
    chatTitle.textContent = session.label;
  }

  appendMessage('user', rawInput);

  userInput.value        = '';
  userInput.style.height = 'auto';

  session.history.push({ role: 'user', content: rawInput });

  showTyping();

  try {
    const response = await fetch(CONFIG.API_URL, {
      method : CONFIG.API_METHOD,
      headers: { 'Content-Type': 'application/json' },
      body   : CONFIG.buildRequestBody(rawInput, session.history),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Server responded with ${response.status}: ${errText || response.statusText}`);
    }

    const data    = await response.json();
    const aiReply = CONFIG.extractReply(data);

    hideTyping();
    appendMessage('ai', aiReply);
    session.history.push({ role: 'assistant', content: aiReply });
    setStatus('ready');

  } catch (error) {
    hideTyping();
    const errMsg = (error instanceof TypeError && error.message.includes('fetch'))
      ? `Cannot connect to the local AI server.\n\nEndpoint: ${CONFIG.API_URL}\n\nMake sure your backend is running and reachable.`
      : `Something went wrong:\n${error.message}`;
    appendMessage('error', errMsg);
    setStatus('error', 'Disconnected');
    console.error('[NeuralChat] API Error:', error);
  } finally {
    isLoading          = false;
    userInput.disabled = false;
    userInput.focus();
    updateSendButton();
  }
}


/* ================================================================
   11. INPUT EVENTS
   ================================================================ */
userInput.addEventListener('input', () => { autoResize(); updateSendButton(); });

userInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!btnSend.disabled) sendMessage();
  }
});

btnSend.addEventListener('click', () => {
  if (!btnSend.disabled) sendMessage();
});


/* ================================================================
   12. SUGGESTION CHIPS
   ================================================================ */
if (suggestionChips) {
  suggestionChips.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const prompt = chip.dataset.prompt;
    if (prompt) {
      userInput.value = prompt;
      autoResize();
      updateSendButton();
      userInput.focus();
      setTimeout(() => sendMessage(), 120);
    }
  });
}


/* ================================================================
   13. NEW CHAT BUTTON
   ================================================================ */
btnNewChat.addEventListener('click', () => {
  // Save scroll of current session
  const cur = sessions.find(s => s.id === activeId);
  if (cur) cur._scrollTop = chatFeed.scrollTop;

  activeId  = null;
  isLoading = false;

  chatFeed.querySelectorAll('.message-group').forEach(el => el.remove());

  if (emptyState) {
    emptyState.hidden      = false;
    emptyState.style.opacity   = '';
    emptyState.style.transform = '';
    emptyState.style.animation = '';
  }

  chatTitle.textContent  = 'New Conversation';
  userInput.value        = '';
  userInput.style.height = 'auto';
  setStatus('ready');
  hideTyping();
  updateSendButton();
  userInput.focus();

  document.querySelectorAll('.history-item--active').forEach(el => {
    el.classList.remove('history-item--active');
  });

  if (window.innerWidth <= 768) {
    sidebar.classList.remove('sidebar--open');
    btnSidebarToggle.setAttribute('aria-expanded','false');
  }
});


/* ================================================================
   14. MOBILE SIDEBAR TOGGLE
   ================================================================ */
btnSidebarToggle.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('sidebar--open');
  btnSidebarToggle.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', e => {
  if (
    window.innerWidth <= 768 &&
    sidebar.classList.contains('sidebar--open') &&
    !sidebar.contains(e.target) &&
    e.target !== btnSidebarToggle
  ) {
    sidebar.classList.remove('sidebar--open');
    btnSidebarToggle.setAttribute('aria-expanded','false');
  }
});


/* ================================================================
   15. INIT
   ================================================================ */
function init() {
  userInput.focus();
  updateSendButton();
  renderSidebar();
  console.log(
    '%c NeuralChat ready ',
    'background:#00d4ff;color:#0d0e12;font-weight:bold;padding:4px 8px;border-radius:4px;',
    `\nEndpoint: ${CONFIG.API_URL}`
  );
}

document.addEventListener('DOMContentLoaded', init);