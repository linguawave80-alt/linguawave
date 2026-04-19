// public/js/dashboard.js
// Dashboard Module
//
// Auth strategy change:
//   ✗  localStorage token / user checks  — removed entirely
//   ✓  ApiClient.bootstrap() attempts silent token refresh via httpOnly cookie
//   ✓  Then /users/me fetches the live user profile from MongoDB Atlas
//   ✓  If both fail → redirect to home (truly unauthenticated)

'use strict';


// ─── State ────────────────────────────────────────────────────────────────────
const AppState = (() => {
  let _state = {
    user: null,   // populated from MongoDB Atlas /users/me
    currentPage: 'practice',
    currentRoom: 'global',
    isRecording: false,
    transcript: '',
    sessionStart: null,
    sessionId: `session_${Date.now()}`,
    accuracyHistory: [],
    socket: null,
    charts: {},
    recordingTimer: null,
    recordingSeconds: 0,
    analyzeData: null,
    recognition: null,
    audioContext: null,
    analyser: null,
    animFrameId: null,
  };
  return {
    get: (key) => key ? _state[key] : { ..._state },
    set: (key, val) => { _state[key] = val; },
    update: (partial) => { Object.assign(_state, partial); },
  };
})();

// ─── Utilities ────────────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const qs = (sel) => document.querySelector(sel);

const showToast = (msg, type = 'info') => {
  const container = el('toastContainer');
  if (!container) return;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 4000);
};

const formatDuration = (secs) => {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─── Auth Guard — cookie-based, profile from MongoDB Atlas ────────────────────
// Shows a loading overlay while we verify the session.
// If the httpOnly cookie is valid the server issues a new access token and
// we immediately fetch the user profile from MongoDB Atlas.
// If the cookie is expired / missing → redirect to home.

const showLoadingOverlay = () => {
  const div = document.createElement('div');
  div.id = 'authOverlay';
  div.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:var(--bg,#050810);gap:16px;
  `;
  div.innerHTML = `
    <div style="width:44px;height:44px;border-radius:50%;
      border:3px solid rgba(127,255,212,.15);
      border-top-color:#7FFFD4;
      animation:spin .7s linear infinite">
    </div>
    <span style="font-size:.875rem;color:rgba(240,244,255,.4)">Verifying session…</span>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.prepend(div);
};

const hideLoadingOverlay = () => el('authOverlay')?.remove();

const bootstrapAuth = async () => {
  showLoadingOverlay();

  try {
    // 1. Try to get a fresh access token from the httpOnly cookie
    const ok = await ApiClient.bootstrap();
    if (!ok) throw new Error('no session');

    // 2. Fetch user profile from MongoDB Atlas
    const res = await ApiClient.users.me();
    const user = res.data?.user;
    if (!user) throw new Error('no user');

    AppState.set('user', user);
    hideLoadingOverlay();
    return user;

  } catch {
    hideLoadingOverlay();
    window.location.href = '/';
    return null;
  }
};

// ─── Navigation ───────────────────────────────────────────────────────────────
const initNavigation = () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
      if (page === 'practice' && window.DailyPhrases) {
        // Re-draw idle wave and make sure phrases are loaded
        drawLiveWave();
      }
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      el('pageTitle').textContent = item.querySelector('span:last-child').textContent;
      if (window.innerWidth <= 768) el('sidebar')?.classList.remove('open');
    });
  });

  el('sidebarToggle')?.addEventListener('click', () => el('sidebar')?.classList.toggle('open'));

  el('logoutBtn')?.addEventListener('click', async () => {
    try { await ApiClient.auth.logout(); } catch { /* ignore */ }
    ApiClient.clearToken();
    // Nothing in localStorage to clear
    window.location.href = '/';
  });
};

const switchPage = (page) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el(`page-${page}`)?.classList.add('active');
  AppState.set('currentPage', page);

  if (page === 'progress') loadProgressCharts();
  if (page === 'sessions') loadSessions(1);
  if (page === 'chat') initChat();
  if (page === 'leaderboard') loadLeaderboard();
  if (page === 'conversation' && !convInitialized) { convInitialized = true; initConversation(); }
};

// ─── User Info (always from the Atlas-fetched user object in AppState) ────────
const initUserInfo = () => {
  const user = AppState.get('user');
  if (!user) return;

  const initial = (user.username || 'U')[0].toUpperCase();
  if (el('sidebarUsername')) el('sidebarUsername').textContent = user.username || 'User';
  if (el('sidebarRole')) el('sidebarRole').textContent = user.role || 'User';
  if (el('userAvatar')) el('userAvatar').textContent = initial;

  // Streak from the activity sub-document (already in the /users/me response)
  const streak = user.activity?.streak?.current ?? 0;
  if (el('streakCount')) el('streakCount').textContent = streak;
};

// ─── Speech Recognition ───────────────────────────────────────────────────────
const initSpeechRecognition = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Speech Recognition not supported. Use Chrome or Edge.', 'error');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = el('langSelect')?.value || 'en-US';
  recognition.maxAlternatives = 3;

  recognition.onresult = (event) => {
    let interim = '', newFinal = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) newFinal += t + ' ';
      else interim += t;
    }
    if (newFinal) {
      const accumulated = (AppState.get('transcript') + ' ' + newFinal).trim();
      AppState.set('transcript', accumulated);
      updateTranscription(accumulated, false);
    } else {
      const current = AppState.get('transcript');
      updateTranscription((current ? current + ' ' : '') + interim, true);
    }
  };

  recognition.onerror = (e) => {
    if (e.error !== 'no-speech') { showToast(`Recognition error: ${e.error}`, 'error'); stopRecording(); }
  };
  recognition.onend = () => { if (AppState.get('isRecording')) recognition.start(); };

  AppState.set('recognition', recognition);
  return recognition;
};

const updateTranscription = (text, isInterim = false) => {
  const box = el('transText');
  if (!box) return;
  if (!text) { box.innerHTML = '<span class="trans-placeholder">Start speaking to see transcription…</span>'; return; }
  box.innerHTML = text + (isInterim ? '<span style="opacity:.4"> …</span>' : '');
  const analyzeBtn = el('analyzeBtn');
  if (analyzeBtn) analyzeBtn.disabled = !text.trim();
};

// ─── Audio Visualizer ─────────────────────────────────────────────────────────
const initAudioVisualizer = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    analyser.fftSize = 256;
    source.connect(analyser);
    AppState.update({ audioContext, analyser, micStream: stream });
    drawLiveWave();
    return stream;
  } catch {
    showToast('Microphone access denied. Please allow microphone.', 'error');
    return null;
  }
};

const drawLiveWave = () => {
  const canvas = el('liveWaveCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth || 300;
  const W = canvas.width, H = canvas.height;
  const analyser = AppState.get('analyser');

  const draw = () => {
    const id = requestAnimationFrame(draw);
    AppState.set('animFrameId', id);
    ctx.clearRect(0, 0, W, H);

    if (!analyser || !AppState.get('isRecording')) {
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
      ctx.strokeStyle = 'rgba(127,255,212,0.2)'; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(127,255,212,0.8)');
    grad.addColorStop(0.5, 'rgba(0,180,216,1)');
    grad.addColorStop(1, 'rgba(127,255,212,0.8)');

    ctx.beginPath(); ctx.strokeStyle = grad; ctx.lineWidth = 2;
    const sliceWidth = W / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * H) / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(127,255,212,0.4)'; ctx.stroke(); ctx.shadowBlur = 0;
  };
  draw();
};

// ─── Recording ────────────────────────────────────────────────────────────────
const startRecording = async () => {
  const recognition = AppState.get('recognition') || initSpeechRecognition();
  if (!recognition) return;
  const stream = await initAudioVisualizer();
  if (!stream) return;

  AppState.update({ isRecording: true, transcript: '', recordingSeconds: 0 });
  AppState.set('sessionId', `session_${Date.now()}`);

  el('micRing')?.classList.add('recording');
  if (el('micStatus')) el('micStatus').textContent = 'Listening…';
  el('recTimer')?.classList.remove('hidden');
  updateTranscription('');

  const lang = el('langSelect')?.value || 'en';
  const langMap = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE', ja: 'ja-JP', zh: 'zh-CN', it: 'it-IT', pt: 'pt-BR' };
  recognition.lang = langMap[lang] || 'en-US';
  recognition.start();

  const timer = setInterval(() => {
    const secs = AppState.get('recordingSeconds') + 1;
    AppState.set('recordingSeconds', secs);
    const timerEl = el('recTimer');
    if (timerEl) timerEl.textContent = formatDuration(secs);
    if (secs >= 120) stopRecording();
  }, 1000);
  AppState.set('recordingTimer', timer);
};

const stopRecording = () => {
  const recognition = AppState.get('recognition');
  const timer = AppState.get('recordingTimer');
  const stream = AppState.get('micStream');
  const audioContext = AppState.get('audioContext');

  if (recognition) { try { recognition.stop(); } catch { } }
  if (timer) clearInterval(timer);
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close();

  AppState.update({ isRecording: false, micStream: null, audioContext: null, analyser: null, recognition: null });
  el('micRing')?.classList.remove('recording');
  if (el('micStatus')) el('micStatus').textContent = 'Tap to speak';
  el('recTimer')?.classList.add('hidden');

  const transcript = AppState.get('transcript');
  if (el('analyzeBtn')) el('analyzeBtn').disabled = !transcript.trim();
};

const initMicButton = () => {
  el('micBtn')?.addEventListener('click', () => {
    if (AppState.get('isRecording')) stopRecording(); else startRecording();
  });
  el('langSelect')?.addEventListener('change', async () => {
    if (AppState.get('isRecording')) stopRecording();
    // Tell DailyPhrases to fetch for the new language
    if (window.DailyPhrases) {
      await DailyPhrases.setLanguage(el('langSelect').value);
    }
  });
};

const loadNewPhrase = () => {
  if (window.DailyPhrases) {
    DailyPhrases.randomPhrase();
    return;
  }
  // Fallback if DailyPhrases not loaded yet
  const lang = el('langSelect')?.value || 'en';
  const fallback = {
    en: [{ text: 'Hello, how are you today?', phonetic: '/hɛˈloʊ haʊ ɑːr juː təˈdeɪ/' }],
    fr: [{ text: 'Bonjour, comment allez-vous?', phonetic: '/bɔ̃.ʒuʁ kɔ.mɑ̃ a.le vu/' }],
    es: [{ text: 'Buenos días, ¿cómo estás?', phonetic: '/ˈbwenos ˈdias ˈkomo esˈtas/' }],
    de: [{ text: 'Guten Morgen, wie geht es?', phonetic: '/ˈɡuːtn̩ ˈmɔʁɡn̩ viː ɡeːt ʔɛs/' }],
    ja: [{ text: 'おはようございます', phonetic: '/o.ha.yoː.ɡo.za.i.ma.su/' }],
  };
  const phrases = fallback[lang] || fallback.en;
  const phrase = phrases[Math.floor(Math.random() * phrases.length)];
  if (el('phraseText')) el('phraseText').textContent = phrase.text;
  if (el('phrasePhonetic')) el('phrasePhonetic').textContent = phrase.phonetic;
  AppState.set('transcript', '');
  updateTranscription('');
  if (el('analyzeBtn')) el('analyzeBtn').disabled = true;
};

// ─── Demo / Fallback Results ──────────────────────────────────────────────────
const getDemoResults = () => ({
  overallAccuracy: 72,
  fluencyScore: 68,
  intonationScore: 75,
  stressScore: 65,
  wordsBreakdown: [
    { word: 'Hello', score: 90, status: 'correct', note: null },
    { word: 'world', score: 60, status: 'close', note: 'Try emphasizing the vowel sound' },
  ],
  suggestions: [
    'Keep practicing — your pronunciation is improving!',
    'Focus on clear vowel sounds.',
    'Try slowing down slightly for better articulation.',
  ],
});

// ─── Pronunciation Analysis ───────────────────────────────────────────────────
const initAnalyzeButton = () => {
  el('analyzeBtn')?.addEventListener('click', async () => {
    // Auto-stop recording if still active so the last chunk finalises
    if (AppState.get('isRecording')) {
      stopRecording();
      await new Promise(r => setTimeout(r, 350)); // let last recognition result fire
    }

    const transcript = AppState.get('transcript');

    // ✅ Read from DailyPhrases module when available
    const targetText = window.DailyPhrases
      ? (DailyPhrases.getCurrentPhrase().text || el('phraseText')?.textContent?.trim())
      : el('phraseText')?.textContent?.trim();

    if (!transcript?.trim()) {
      showToast('Please record yourself speaking first.', 'error');
      return;
    }
    if (!targetText?.trim()) {
      showToast('No target phrase found. Try refreshing phrases.', 'error');
      return;
    }

    const btn = el('analyzeBtn');
    const spinner = btn?.querySelector('.btn-spinner');
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
      const language = el('langSelect')?.value || 'en';
      const sessionId = AppState.get('sessionId');
      const duration = AppState.get('recordingSeconds');

      const res = await ApiClient.speech.analyze({
        targetText, transcribedText: transcript, language, sessionId,
      });

      const data = res.data;
      AppState.update({ analyzeData: data });

      const history = AppState.get('accuracyHistory');
      history.push({ date: new Date().toLocaleDateString(), accuracy: data.overallAccuracy });
      if (history.length > 10) history.shift();

      renderResults(data);

      const words = transcript.split(' ').length;
      const correct = Math.round(words * (data.overallAccuracy / 100));
      await ApiClient.sessions.create({
        language, duration, accuracy: data.overallAccuracy,
        wordsAttempted: words, wordsCorrect: correct,
        transcript, feedback: data.suggestions?.join('; '),
      }).catch(() => { });

      showToast(`Analysis complete! Score: ${data.overallAccuracy}%`, 'success');

    } catch (err) {
      console.error('[Analyze] Error:', err);
      showToast(err.message || 'Analysis failed. Check your connection.', 'error');
      renderResults(getDemoResults());
    } finally {
      if (btn) btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
    }
  });
};

// ─── Render Results ───────────────────────────────────────────────────────────
const renderResults = (data) => {
  // Hide the empty-state placeholder
  const emptyEl = el('resultsEmpty');
  if (emptyEl) { emptyEl.classList.add('hidden'); emptyEl.style.display = 'none'; }

  // Show the results panel — remove 'hidden' class AND force display
  const contentEl = el('resultsContent');
  if (contentEl) { contentEl.classList.remove('hidden'); contentEl.style.display = 'block'; }

  // Scroll results into view on mobile
  el('resultsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  drawScoreRing(data.overallAccuracy);
  if (el('overallScore')) el('overallScore').textContent = data.overallAccuracy + '%';

  const scores = [
    { bar: 'fluencyBar', num: 'fluencyNum', val: data.fluencyScore ?? 0 },
    { bar: 'intonationBar', num: 'intonationNum', val: data.intonationScore ?? 0 },
    { bar: 'stressBar', num: 'stressNum', val: data.stressScore ?? 0 },
  ];
  scores.forEach(({ bar, num, val }) => {
    const barEl = el(bar), numEl = el(num);
    if (barEl) {
      setTimeout(() => { barEl.style.width = val + '%'; }, 100);
      barEl.style.background = val >= 80
        ? 'linear-gradient(90deg,#7FFFD4,#00B4D8)'
        : val >= 60 ? 'linear-gradient(90deg,#FFD166,#FF9B42)' : 'linear-gradient(90deg,#FF6B6B,#FF4757)';
    }
    if (numEl) numEl.textContent = val + '%';
  });

  const grid = el('wordsGrid');
  if (grid && data.wordsBreakdown) {
    grid.innerHTML = data.wordsBreakdown.map(w => `
      <div class="word-chip ${w.status}" title="${w.note || ''}">
        ${w.word}<span class="word-score">${w.score}%</span>
      </div>
    `).join('');
  }

  const list = el('suggestionsList');
  if (list && data.suggestions) list.innerHTML = data.suggestions.map(s => `<li>${s}</li>`).join('');

  drawMiniTrendChart();
};

// ─── Score Ring ───────────────────────────────────────────────────────────────
const drawScoreRing = (score) => {
  const canvas = el('overallScoreCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = 55;
  const full = Math.PI * 2, start = -Math.PI / 2;
  let current = 0;
  const target = score / 100;
  const color = score >= 80 ? '#7FFFD4' : score >= 60 ? '#FFD166' : '#FF6B6B';

  const animate = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, full);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 10; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r, start, start + full * current);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, color); grad.addColorStop(1, '#00B4D8');
    ctx.strokeStyle = grad; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.shadowBlur = 12; ctx.shadowColor = color + '80'; ctx.stroke(); ctx.shadowBlur = 0;
    current = Math.min(current + 0.025, target);
    if (current < target) requestAnimationFrame(animate);
  };
  animate();
};

// ─── Mini Trend Chart ─────────────────────────────────────────────────────────
const drawMiniTrendChart = () => {
  const canvas = el('miniTrendChart');
  if (!canvas) return;
  const history = AppState.get('accuracyHistory');
  if (!history.length) return;

  const existing = AppState.get('charts').miniTrend;
  if (existing) existing.destroy();

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        data: history.map(h => h.accuracy), borderColor: '#7FFFD4',
        backgroundColor: 'rgba(127,255,212,0.08)', borderWidth: 2,
        pointBackgroundColor: '#7FFFD4', pointRadius: 4, fill: true, tension: 0.4
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: 'rgba(240,244,255,.3)', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } },
        y: { min: 0, max: 100, ticks: { color: 'rgba(240,244,255,.3)', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,.04)' } },
      },
    },
  });
  const charts = AppState.get('charts');
  charts.miniTrend = chart;
};

// ─── AI Conversation ──────────────────────────────────────────────────────────
const initConversation = () => {
  let convHistory = [], convRecording = false, convRecognition = null;
  let isSpeaking = false;
  const langCodes = {
    French: 'fr-FR', Spanish: 'es-ES', English: 'en-US',
    German: 'de-DE', Japanese: 'ja-JP', Italian: 'it-IT', Portuguese: 'pt-BR', Mandarin: 'zh-CN',
  };

  const convMessages = el('convMessages');
  const convMicBtn = el('convMicBtn');
  const convMicRing = el('convMicRing');
  const convMicLabel = el('convMicLabel');
  const convSendBtn = el('convSendBtn');
  const convTextInput = el('convTextInput');
  const convLangSelect = el('convLang');
  const convScoreBar = el('convScoreBar');
  const convScoreFill = el('convScoreFill');
  const convScoreNum = el('convScoreNum');
  const convEncourage = el('convEncouragement');
  const convAiSpeak = el('convAiSpeaking');

  const addMessage = (role, text, translation = null, correction = null) => {
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.className = `conv-msg ${isUser ? 'user' : 'ai'}`;
    div.innerHTML = `
      <div class="conv-avatar">${isUser ? '🧑' : '🤖'}</div>
      <div class="conv-bubble">
        <div class="conv-text">${text}</div>
        ${translation ? `<div class="conv-translation">📖 ${translation}</div>` : ''}
        ${correction ? `<div class="conv-correction">✏️ ${correction}</div>` : ''}
      </div>
    `;
    convMessages.appendChild(div);
    convMessages.scrollTop = convMessages.scrollHeight;
  };

  const addSuggestion = (correction, encouragement, original) => {
    const list = el('convSuggestionsContent');
    // Remove empty state if present
    if (list) {
      const empty = list.querySelector('.suggestions-empty');
      if (empty) empty.remove();

      if (!correction && !encouragement) return;

      const div = document.createElement('div');
      div.className = 'suggestion-card';
      div.innerHTML = `
        ${original ? `<div class="suggestion-original">"${original}"</div>` : ''}
        ${correction ? `<div class="suggestion-correction">✏️ ${correction}</div>` : ''}
        ${encouragement ? `<div class="suggestion-encouragement">💡 ${encouragement}</div>` : ''}
      `;
      list.prepend(div);

      // Auto-open panel on new suggestions
      const wrapper = document.getElementById('convActiveWrapper');
      if (wrapper) wrapper.classList.remove('suggestions-closed');
    }
  };


  const showLoadingBubble = () => {
    const div = document.createElement('div');
    div.className = 'conv-msg ai conv-loading'; div.id = 'convLoadingBubble';
    div.innerHTML = `<div class="conv-avatar">🤖</div>
      <div class="conv-bubble"><div class="conv-text">
        <span class="speaking-dot"></span><span class="speaking-dot"></span><span class="speaking-dot"></span>
      </div></div>`;
    convMessages.appendChild(div); convMessages.scrollTop = convMessages.scrollHeight;
  };
  const removeLoadingBubble = () => el('convLoadingBubble')?.remove();

  const updateScore = (score, encouragement) => {
    if (!score) return;
    convScoreBar.style.display = 'flex';
    setTimeout(() => { if (convScoreFill) convScoreFill.style.width = score + '%'; }, 100);
    if (convScoreNum) convScoreNum.textContent = score + '%';
    if (convEncourage) convEncourage.textContent = encouragement || '';
    if (window.ScoreChart && typeof score === 'number') {
      const fluencyProxy = Math.min(100, Math.max(0, score + Math.round((Math.random() - .5) * 10)));
      ScoreChart.addScore(score, fluencyProxy);
    }
    const color = score >= 80 ? 'linear-gradient(90deg,#7FFFD4,#00B4D8)'
      : score >= 60 ? 'linear-gradient(90deg,#FFD166,#FF9B42)' : 'linear-gradient(90deg,#FF6B6B,#FF4757)';
    if (convScoreFill) convScoreFill.style.background = color;
  };

  const speakText = (text, lang) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); isSpeaking = true;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = langCodes[lang] || 'en-US';
    utt.rate = 0.85; utt.pitch = 1.0; utt.volume = 1.0;
    convAiSpeak?.classList.remove('hidden');
    utt.onend = () => { isSpeaking = false; convAiSpeak?.classList.add('hidden'); };
    utt.onerror = () => { isSpeaking = false; convAiSpeak?.classList.add('hidden'); };
    window.speechSynthesis.speak(utt);
  };

  const sendToAI = async (userText) => {
    if (!userText.trim()) return;
    addMessage('user', userText);
    convHistory.push({ role: 'user', text: userText });
    const systemPrompt = window.ConvSettings ? ConvSettings.getSystemContext()
      : `You are an AI language tutor. Respond in ${convLangSelect?.value || 'English'}.`;
    showLoadingBubble();

    try {
      const API = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '';
      const res = await fetch(`${API}/api/v1/conversation/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ApiClient.getToken()}` },
        body: JSON.stringify({
          userMessage: userText, language: convLangSelect?.value || 'English',
          conversationHistory: convHistory.slice(-6), systemPrompt,
        }),
      });
      const data = await res.json();
      removeLoadingBubble();
      if (!data.success) throw new Error(data.error);
      const { reply, translation, correction, score, encouragement } = data.data;
      addMessage('ai', reply, translation, correction);
      convHistory.push({ role: 'ai', text: reply });
      updateScore(score, encouragement);
      speakText(reply, convLangSelect?.value || 'English');
      addSuggestion(correction, encouragement, userText);
    } catch {
      removeLoadingBubble();
      const fallback = getDemoReply(userText, convLangSelect?.value);
      addMessage('ai', fallback.reply, fallback.translation, fallback.correction);
      convHistory.push({ role: 'ai', text: fallback.reply });
      updateScore(fallback.score, fallback.encouragement);
      speakText(fallback.reply, convLangSelect?.value || 'English');
      addSuggestion(fallback.correction, fallback.encouragement, userText);
    }
  };

  const getDemoReply = (userText, lang) => {
    const replies = {
      French: { reply: "C'est très bien! Continuez à pratiquer.", translation: "That's very good! Keep practicing.", correction: null, score: 72 + Math.floor(Math.random() * 20), encouragement: "Great effort! 🌟" },
      Spanish: { reply: "¡Muy bien! Sigue practicando tu español.", translation: "Very good! Keep practicing.", correction: null, score: 75 + Math.floor(Math.random() * 20), encouragement: "Excellent! 🎉" },
      German: { reply: "Sehr gut! Weiter so!", translation: "Very good! Keep it up!", correction: null, score: 70 + Math.floor(Math.random() * 20), encouragement: "Wunderbar! 🌟" },
    };
    return replies[lang] || replies.French;
  };

  const startConvRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast('Speech Recognition not supported. Use text input.', 'error'); return; }
    if (isSpeaking) window.speechSynthesis.cancel();
    convRecognition = new SR();
    convRecognition.lang = langCodes[convLangSelect?.value] || 'en-US';
    convRecognition.continuous = false; convRecognition.interimResults = false;
    convRecognition.onstart = () => { convRecording = true; convMicRing?.classList.add('recording'); if (convMicLabel) convMicLabel.textContent = 'Listening…'; };
    convRecognition.onresult = (e) => { const text = e.results[0][0].transcript; if (convTextInput) convTextInput.value = text; sendToAI(text); };
    convRecognition.onend = () => { convRecording = false; convMicRing?.classList.remove('recording'); if (convMicLabel) convMicLabel.textContent = 'Hold to speak'; };
    convRecognition.onerror = (e) => { showToast(`Mic error: ${e.error}`, 'error'); convRecording = false; convMicRing?.classList.remove('recording'); if (convMicLabel) convMicLabel.textContent = 'Hold to speak'; };
    convRecognition.start();
  };
  const stopConvRecording = () => { convRecognition?.stop(); convRecording = false; convMicRing?.classList.remove('recording'); if (convMicLabel) convMicLabel.textContent = 'Hold to speak'; };

  convMicBtn?.addEventListener('mousedown', startConvRecording);
  convMicBtn?.addEventListener('mouseup', stopConvRecording);
  convMicBtn?.addEventListener('mouseleave', stopConvRecording);
  convMicBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); startConvRecording(); });
  convMicBtn?.addEventListener('touchend', (e) => { e.preventDefault(); stopConvRecording(); });
  convMicBtn?.addEventListener('click', () => { if (!convRecording) startConvRecording(); else stopConvRecording(); });

  convSendBtn?.addEventListener('click', () => { const t = convTextInput?.value.trim(); if (t) { sendToAI(t); if (convTextInput) convTextInput.value = ''; } });
  convTextInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const t = convTextInput.value.trim(); if (t) { sendToAI(t); convTextInput.value = ''; } } });
  convLangSelect?.addEventListener('change', () => { });
  el('resetConvBtn')?.addEventListener('click', () => {
    convHistory = []; window.speechSynthesis.cancel();
    if (convMessages) convMessages.innerHTML = `<div class="conv-msg ai"><div class="conv-avatar">🤖</div><div class="conv-bubble"><div class="conv-text">New conversation started! Ready when you are!</div></div></div>`;
    if (convScoreBar) convScoreBar.style.display = 'none';
    if (window.ScoreChart) ScoreChart.reset();
    if (convScoreFill) convScoreFill.style.width = '0%';
    const list = el('convSuggestionsContent');
    if (list) {
      list.innerHTML = `<div class="suggestions-empty"><div class="empty-icon">📝</div><p>Start chatting to see language suggestions here.</p></div>`;
    }
    const wrapper = document.getElementById('convActiveWrapper');
    if (wrapper) wrapper.classList.remove('suggestions-closed');
  });

  const closeBtn = document.getElementById('closeSuggestionsBtn');
  const wrapper = document.getElementById('convActiveWrapper');
  if (closeBtn && wrapper) {
    closeBtn.addEventListener('click', () => {
      wrapper.classList.add('suggestions-closed');
    });
  }
};

let convInitialized = false;

// ─── Progress Charts ──────────────────────────────────────────────────────────
let chartsLoaded = false;
const loadProgressCharts = async () => {
  if (chartsLoaded) return;
  chartsLoaded = true;

  Chart.defaults.color = 'rgba(240,244,255,0.5)';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = "'DM Sans', sans-serif";

  let trendData = [];
  try { const res = await ApiClient.speech.accuracyTrend(30); trendData = res.data?.trend || []; } catch { }
  if (!trendData.length) {
    trendData = Array.from({ length: 14 }, (_, i) => ({
      _id: new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString('en-CA'),
      avgAccuracy: 55 + Math.random() * 35,
      count: Math.floor(1 + Math.random() * 5),
    }));
  }

  const accCanvas = el('accuracyChart');
  if (accCanvas) {
    const existing = Chart.getChart(accCanvas); if (existing) existing.destroy();
    new Chart(accCanvas, {
      type: 'line',
      data: { labels: trendData.map(d => d._id), datasets: [{ label: 'Accuracy %', data: trendData.map(d => Math.round(d.avgAccuracy)), borderColor: '#7FFFD4', backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 160); g.addColorStop(0, 'rgba(127,255,212,0.18)'); g.addColorStop(1, 'rgba(127,255,212,0)'); return g; }, borderWidth: 2.5, pointBackgroundColor: '#7FFFD4', pointRadius: 4, fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0d1120', borderColor: 'rgba(127,255,212,.2)', borderWidth: 1 } }, scales: { x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { maxTicksLimit: 7, font: { size: 11 } } }, y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.04)' }, ticks: { callback: v => v + '%', font: { size: 11 } } } } },
    });
  }

  const radarCanvas = el('radarChart');
  if (radarCanvas) {
    const existing = Chart.getChart(radarCanvas); if (existing) existing.destroy();
    new Chart(radarCanvas, {
      type: 'radar',
      data: { labels: ['Accuracy', 'Fluency', 'Intonation', 'Stress', 'Vocab', 'Rhythm'], datasets: [{ label: 'Your Skills', data: [75, 68, 72, 65, 80, 70], backgroundColor: 'rgba(127,255,212,0.08)', borderColor: '#7FFFD4', pointBackgroundColor: '#7FFFD4', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.08)' }, ticks: { display: false }, pointLabels: { color: 'rgba(240,244,255,.6)', font: { size: 11 } } } } },
    });
  }

  const barCanvas = el('sessionsBarChart');
  if (barCanvas) {
    const existing = Chart.getChart(barCanvas); if (existing) existing.destroy();
    new Chart(barCanvas, {
      type: 'bar',
      data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{ label: 'Sessions', data: [2, 3, 1, 4, 2, 5, 3], backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, 'rgba(127,255,212,0.8)'); g.addColorStop(1, 'rgba(0,180,216,0.3)'); return g; }, borderRadius: 8, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { stepSize: 1 } } } },
    });
  }

  const langList = el('langProgressList');
  if (langList) {
    const langs = [{ name: '🇺🇸 English', pct: 78 }, { name: '🇫🇷 French', pct: 54 }, { name: '🇪🇸 Spanish', pct: 42 }, { name: '🇩🇪 German', pct: 25 }];
    langList.innerHTML = langs.map(l => `
      <div class="lang-progress-item">
        <span class="lang-progress-name">${l.name}</span>
        <div class="lang-bar-wrap"><div class="lang-bar" style="width:0%;max-width:100%" data-target="${l.pct}"></div></div>
        <span class="lang-pct">${l.pct}%</span>
      </div>
    `).join('');
    requestAnimationFrame(() => setTimeout(() => { document.querySelectorAll('.lang-bar').forEach(b => { b.style.width = b.dataset.target + '%'; }); }, 200));
  }

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      const days = parseInt(btn.dataset.days);
      let newData = [];
      try { const res = await ApiClient.speech.accuracyTrend(days); newData = res.data?.trend || []; } catch { }
      if (!newData.length) newData = Array.from({ length: days > 7 ? 14 : 7 }, (_, i) => ({ _id: new Date(Date.now() - (days - i) * 86400000).toLocaleDateString('en-CA'), avgAccuracy: 55 + Math.random() * 35 }));
      const c = el('accuracyChart'); if (c) { const chart = Chart.getChart(c); if (chart) { chart.data.labels = newData.map(d => d._id); chart.data.datasets[0].data = newData.map(d => Math.round(d.avgAccuracy)); chart.update(); } }
    });
  });
};

// ─── Sessions ─────────────────────────────────────────────────────────────────
const loadSessions = async (page = 1) => {
  const lang = el('sessionLangFilter')?.value || '';
  const list = el('sessionsList');
  if (list) list.innerHTML = '<div class="list-loading">Loading…</div>';
  const langFlags = { en: '🇺🇸', fr: '🇫🇷', es: '🇪🇸', de: '🇩🇪', ja: '🇯🇵', zh: '🇨🇳', it: '🇮🇹', pt: '🇧🇷' };
  try {
    const params = { page, limit: 10, ...(lang ? { language: lang } : {}) };
    const res = await ApiClient.sessions.list(params);
    const { sessions, pagination } = res.data;
    if (!sessions.length) { list.innerHTML = '<div class="list-loading">No sessions yet. Start practicing!</div>'; return; }
    list.innerHTML = sessions.map(s => {
      const accClass = s.accuracy >= 80 ? '' : s.accuracy >= 60 ? 'medium' : 'low';
      return `<div class="session-item"><span class="sess-lang">${langFlags[s.language] || '🌐'}</span><div class="sess-info"><div class="sess-date">${formatDate(s.createdAt)}</div><div class="sess-words">${s.wordsCorrect}/${s.wordsAttempted} words correct</div></div><span class="sess-dur">${formatDuration(s.duration)}</span><span class="sess-accuracy ${accClass}">${Math.round(s.accuracy)}%</span></div>`;
    }).join('');
    const pag = el('sessionsPagination');
    if (pag && pagination.totalPages > 1) {
      pag.innerHTML = Array.from({ length: pagination.totalPages }, (_, i) => `<button class="page-btn ${i + 1 === page ? 'active' : ''}" data-page="${i + 1}">${i + 1}</button>`).join('');
      pag.querySelectorAll('.page-btn').forEach(btn => { btn.addEventListener('click', () => loadSessions(parseInt(btn.dataset.page))); });
    }
  } catch { list.innerHTML = '<div class="list-loading">Error loading sessions.</div>'; }
};

// ─── Leaderboard ──────────────────────────────────────────────────────────────
const loadLeaderboard = async () => {
  const list = el('lbList');
  if (!list) return;
  try {
    const res = await ApiClient.users.leaderboard();
    const lb = res.data?.leaderboard || [];
    if (!lb.length) { list.innerHTML = '<div class="list-loading">No data yet. Be the first!</div>'; return; }
    const medals = ['🥇', '🥈', '🥉'];
    list.innerHTML = lb.map((user, i) => `
      <div class="lb-item">
        <span class="lb-rank ${i < 3 ? 'top' : ''}">${medals[i] || i + 1}</span>
        <div class="lb-avatar">${(user.userId || 'U')[0].toUpperCase()}</div>
        <div><div class="lb-name">User #${(user.userId || '').slice(-6)}</div><div class="lb-sessions">${user.totalSessions} sessions · ${user.totalMinutes || 0} mins</div></div>
        <span class="lb-streak">🔥 ${user.streak?.current || 0}</span>
      </div>
    `).join('');
  } catch { list.innerHTML = '<div class="list-loading">Leaderboard unavailable.</div>'; }
};

// ─── Chat ─────────────────────────────────────────────────────────────────────
let chatInitialized = false;
const initChat = () => {
  if (chatInitialized) return;
  chatInitialized = true;
  const SERVER_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000' : '/';
  let socket;
  try {
    // Pass the in-memory access token — NOT from localStorage
    socket = io(SERVER_URL, { auth: { token: ApiClient.getToken() }, transports: ['websocket', 'polling'] });
    AppState.set('socket', socket);
  } catch { showToast('Could not connect to chat server', 'error'); return; }

  socket.on('connect', () => { socket.emit('chat:join', AppState.get('currentRoom')); loadChatMessages(AppState.get('currentRoom')); });
  socket.on('users:online', (count) => { if (el('onlineCount')) el('onlineCount').textContent = count; });
  socket.on('chat:message', (msg) => appendChatMessage(msg));
  socket.on('chat:userJoined', (data) => appendSystemMessage(`${data.username} joined the room`));
  socket.on('chat:typing', ({ username, isTyping }) => {
    const indicator = el('typingIndicator'), typingUser = el('typingUser');
    if (indicator && typingUser) { typingUser.textContent = `${username} is typing`; indicator.classList.toggle('hidden', !isTyping); }
  });
  socket.on('disconnect', () => showToast('Disconnected from chat', 'error'));

  // Token refresh — update socket auth without reconnecting
  window.addEventListener('auth:tokenRefreshed', () => { if (socket.connected) socket.auth = { token: ApiClient.getToken() }; });

  document.querySelectorAll('.room-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newRoom = btn.dataset.room, oldRoom = AppState.get('currentRoom');
      document.querySelectorAll('.room-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      socket.emit('chat:leave', oldRoom); AppState.set('currentRoom', newRoom);
      socket.emit('chat:join', newRoom); loadChatMessages(newRoom);
    });
  });

  const sendMsg = () => { const input = el('chatInput'), content = input?.value.trim(); if (!content) return; socket.emit('chat:message', { content, roomId: AppState.get('currentRoom') }); input.value = ''; };
  el('chatSend')?.addEventListener('click', sendMsg);
  el('chatInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
  let typingTimeout;
  el('chatInput')?.addEventListener('input', () => {
    socket.emit('chat:typing', { roomId: AppState.get('currentRoom'), isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('chat:typing', { roomId: AppState.get('currentRoom'), isTyping: false }), 2000);
  });
};

const loadChatMessages = async (roomId) => {
  const container = el('chatMessages');
  if (container) container.innerHTML = '<div class="chat-loading">Loading…</div>';
  try {
    const res = await ApiClient.chat.messages(roomId);
    const messages = res.data?.messages || [];
    if (container) {
      container.innerHTML = '';
      if (!messages.length) { container.innerHTML = '<div class="chat-loading">No messages yet. Say hello!</div>'; return; }
      messages.forEach(msg => appendChatMessage(msg, false));
      container.scrollTop = container.scrollHeight;
    }
  } catch { if (container) container.innerHTML = '<div class="chat-loading">Could not load messages.</div>'; }
};

const appendChatMessage = (msg, scroll = true) => {
  const container = el('chatMessages'); if (!container) return;
  const user = AppState.get('user');
  const isOwn = msg.user?.id === user?.id || msg.userId === user?.id;
  const username = msg.user?.username || 'Anonymous';
  const time = new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  container.querySelector('.chat-loading')?.remove();
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${isOwn ? 'own' : ''}`;
  msgEl.innerHTML = `<div class="msg-avatar">${username[0].toUpperCase()}</div><div class="msg-body">${!isOwn ? `<span class="msg-name">${username}</span>` : ''}<div class="msg-bubble">${msg.content}</div><span class="msg-time">${time}</span></div>`;
  container.appendChild(msgEl);
  if (scroll) container.scrollTop = container.scrollHeight;
};

const appendSystemMessage = (text) => {
  const container = el('chatMessages'); if (!container) return;
  const div = document.createElement('div'); div.className = 'system-msg'; div.textContent = text;
  container.appendChild(div); container.scrollTop = container.scrollHeight;
};

const initSessionFilters = () => el('sessionLangFilter')?.addEventListener('change', () => loadSessions(1));

// ─── Boot ─────────────────────────────────────────────────────────────────────
// Everything starts here. bootstrapAuth() validates the session against
// MongoDB Atlas before rendering anything — no localStorage involved.
document.addEventListener('DOMContentLoaded', async () => {
  const user = await bootstrapAuth();   // validates cookie → fetches profile from Atlas
  if (!user) return;                    // redirected to home already

  initNavigation();
  initUserInfo();
  initMicButton();
  initAnalyzeButton();
  initSessionFilters();
  drawLiveWave();
});
