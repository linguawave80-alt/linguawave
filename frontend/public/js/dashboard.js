// public/js/dashboard.js
// Dashboard Module
//
// Auth strategy change:
//   ✗  localStorage token / user checks  — removed entirely
//   ✓  ApiClient.bootstrap() attempts silent token refresh via httpOnly cookie
//   ✓  Then /users/me fetches the live user profile from MongoDB Atlas
//   ✓  If both fail → redirect to home (truly unauthenticated)
//
// Mobile mic fixes:
//   ✓  AudioContext created inside user-gesture handler (not at module level)
//   ✓  audioContext.resume() called before use (Chrome mobile autoplay policy)
//   ✓  getUserMedia constraints are mobile-friendly (echoCancellation, noiseSuppression)
//   ✓  SpeechRecognition: continuous=false on iOS (continuous unsupported)
//   ✓  Fallback text-input shown automatically on iOS Safari (no Web Speech API)
//   ✓  Mic button uses both click AND touchstart/touchend to work on mobile
//   ✓  Canvas resized on orientationchange to avoid blurry waveform on mobile

'use strict';

// ─── Browser / device detection ───────────────────────────────────────────────
const UA = navigator.userAgent;
const IS_IOS        = /iPad|iPhone|iPod/.test(UA) && !window.MSStream;
const IS_ANDROID    = /Android/.test(UA);
const IS_MOBILE     = IS_IOS || IS_ANDROID || /webOS|BlackBerry|IEMobile|Opera Mini/.test(UA);
const HAS_SPEECH_API = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// iOS Safari does NOT support the Web Speech API at all
const SPEECH_SUPPORTED = HAS_SPEECH_API && !IS_IOS;

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
    micStream: null,
  };
  return {
    get: (key) => key ? _state[key] : { ..._state },
    set: (key, val) => { _state[key] = val; },
    update: (partial) => { Object.assign(_state, partial); },
  };
})();

// ─── Utilities ────────────────────────────────────────────────────────────────
const el  = (id)  => document.getElementById(id);
const qs  = (sel) => document.querySelector(sel);

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
    const ok = await ApiClient.bootstrap();
    if (!ok) throw new Error('no session');
    const res  = await ApiClient.users.me();
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
      // Logic for external links: let browser handle it (e.g., target="_blank")
      if (item.classList.contains('external-link') || item.getAttribute('target') === '_blank') return;

      e.preventDefault();
      const page = item.dataset.page;
      if (!page) return;
      switchPage(page);
      if (page === 'practice' && window.DailyPhrases) drawLiveWave();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      el('pageTitle').textContent = item.querySelector('span:last-child').textContent;
      if (window.innerWidth <= 768) window._closeSidebar?.();
    });
  });

  el('logoutBtn')?.addEventListener('click', async () => {
    try { await ApiClient.auth.logout(); } catch { /* ignore */ }
    ApiClient.clearToken();
    window.location.href = '/';
  });
};

const switchPage = (page) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  el(`page-${page}`)?.classList.add('active');
  AppState.set('currentPage', page);
  if (page === 'progress')     loadProgressCharts();
  if (page === 'sessions')     loadSessions(1);
  if (page === 'chat')         initChat();
  if (page === 'leaderboard')  loadLeaderboard();
  if (page === 'conversation' && !convInitialized) { convInitialized = true; initConversation(); }
};

// ─── User Info ────────────────────────────────────────────────────────────────
const initUserInfo = () => {
  const user = AppState.get('user');
  if (!user) return;
  const initial = (user.username || 'U')[0].toUpperCase();
  if (el('sidebarUsername')) el('sidebarUsername').textContent = user.username || 'User';
  if (el('sidebarRole'))     el('sidebarRole').textContent     = user.role     || 'User';
  if (el('userAvatar'))      el('userAvatar').textContent      = initial;
  const streak = user.activity?.streak?.current ?? 0;
  if (el('streakCount')) el('streakCount').textContent = streak;
};

// ─── Mobile UI Helpers ────────────────────────────────────────────────────────
/**
 * Show a fallback textarea + manual-submit for iOS where Speech API is absent.
 * Called once from initMicButton() when SPEECH_SUPPORTED is false.
 */
const showMobileFallbackInput = () => {
  const section = el('micSection') || document.querySelector('.mic-section');
  if (!section) return;

  // Replace mic section content with a text area fallback
  section.innerHTML = `
    <div class="mobile-fallback-wrap" style="width:100%;display:flex;flex-direction:column;gap:10px;">
      <div class="mic-status" style="text-align:center;font-size:.8rem;color:var(--text-3)">
        🎙️ Speech recognition isn't supported on your browser.<br>Type what you said below:
      </div>
      <textarea
        id="mobileFallbackText"
        rows="3"
        placeholder="Type your spoken text here…"
        style="width:100%;padding:12px 14px;background:var(--bg-2);border:1px solid var(--border);
               border-radius:12px;color:var(--text);font-size:.9rem;resize:none;outline:none;
               font-family:var(--font-body);line-height:1.5;transition:border-color .25s"
      ></textarea>
      <button id="mobileFallbackSubmit"
        style="padding:10px 20px;border-radius:12px;background:var(--grad-main);
               color:#05080f;font-family:var(--font-display);font-size:.85rem;font-weight:700;
               border:none;cursor:pointer;transition:opacity .2s">
        Use This Text
      </button>
    </div>
  `;

  el('mobileFallbackSubmit')?.addEventListener('click', () => {
    const text = el('mobileFallbackText')?.value.trim();
    if (!text) return;
    AppState.set('transcript', text);
    updateTranscription(text, false);
  });

  el('mobileFallbackText')?.addEventListener('input', (e) => {
    const text = e.target.value.trim();
    AppState.set('transcript', text);
    if (el('analyzeBtn')) el('analyzeBtn').disabled = !text;
  });
};

// ─── Speech Recognition ───────────────────────────────────────────────────────
const initSpeechRecognition = () => {
  if (!SPEECH_SUPPORTED) return null;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();

  // Android Chrome: continuous works; desktop Chrome: continuous works.
  // iOS: not supported (handled by fallback above).
  recognition.continuous      = !IS_MOBILE; // continuous = false on mobile to avoid glitches
  recognition.interimResults  = true;
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
    // 'no-speech' and 'aborted' are harmless — ignore them
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    // 'not-allowed' means the user denied the mic permission
    if (e.error === 'not-allowed') {
      showToast('Microphone permission denied. Please allow mic access in your browser settings.', 'error');
      stopRecording();
      return;
    }
    showToast(`Recognition error: ${e.error}`, 'error');
    stopRecording();
  };

  // On mobile with continuous=false the browser fires 'end' after each utterance.
  // Restart automatically while still in recording state.
  recognition.onend = () => {
    if (AppState.get('isRecording')) {
      try { recognition.start(); } catch { /* already started */ }
    }
  };

  AppState.set('recognition', recognition);
  return recognition;
};

const updateTranscription = (text, isInterim = false) => {
  const box = el('transText');
  if (!box) return;
  if (!text) {
    box.innerHTML = '<span class="trans-placeholder">Start speaking to see transcription…</span>';
    return;
  }
  box.innerHTML = text + (isInterim ? '<span style="opacity:.4"> …</span>' : '');
  if (el('analyzeBtn')) el('analyzeBtn').disabled = !text.trim();
};

// ─── Audio Visualizer (Web Audio API) ────────────────────────────────────────
/**
 * KEY MOBILE FIX:
 *   • AudioContext must be created INSIDE a user-gesture handler on mobile.
 *   • After creation, call audioContext.resume() — Chrome/Android suspends it immediately.
 *   • getUserMedia constraints include echoCancellation + noiseSuppression for mobile.
 */
const initAudioVisualizer = async () => {
  try {
    // Mobile-friendly constraints
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Don't specify sampleRate — let the device choose its native rate
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Create AudioContext inside the gesture handler
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioCtx();

    // CRITICAL for mobile: Chrome/Android suspends AudioContext by default
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    AppState.update({ audioContext, analyser, micStream: stream });
    drawLiveWave();
    return stream;

  } catch (err) {
    // Provide clear, device-specific error messages
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showToast('Microphone access denied. Tap the lock icon in your browser to allow.', 'error');
    } else if (err.name === 'NotFoundError') {
      showToast('No microphone found on this device.', 'error');
    } else if (err.name === 'NotReadableError') {
      showToast('Microphone is being used by another app. Please close it and try again.', 'error');
    } else {
      showToast('Could not access microphone: ' + err.message, 'error');
    }
    return null;
  }
};

const drawLiveWave = () => {
  const canvas = el('liveWaveCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Recalculate on every call (handles orientation change on mobile)
  const resizeCanvas = () => {
    canvas.width  = canvas.offsetWidth  || 300;
    canvas.height = canvas.offsetHeight || 56;
  };
  resizeCanvas();

  // Cancel any previous animation loop before starting a new one
  const prevId = AppState.get('animFrameId');
  if (prevId) cancelAnimationFrame(prevId);

  const draw = () => {
    const W = canvas.width, H = canvas.height;
    const analyser = AppState.get('analyser');
    const id = requestAnimationFrame(draw);
    AppState.set('animFrameId', id);
    ctx.clearRect(0, 0, W, H);

    if (!analyser || !AppState.get('isRecording')) {
      // Idle flat line
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.strokeStyle = 'rgba(127,255,212,0.2)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      return;
    }

    const bufLen    = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufLen);
    analyser.getByteTimeDomainData(dataArray);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0,   'rgba(127,255,212,0.8)');
    grad.addColorStop(0.5, 'rgba(0,180,216,1)');
    grad.addColorStop(1,   'rgba(127,255,212,0.8)');

    ctx.beginPath();
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 2;
    const sliceW = W / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * H) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.shadowBlur  = 8;
    ctx.shadowColor = 'rgba(127,255,212,0.4)';
    ctx.stroke();
    ctx.shadowBlur  = 0;
  };
  draw();

  // Re-size canvas on orientation change (mobile)
  window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 300); // wait for layout to settle
  });
};

// ─── Recording Controls ───────────────────────────────────────────────────────
const startRecording = async () => {
  // Don't double-start
  if (AppState.get('isRecording')) return;

  // Build recognition object fresh each time (avoids stale state on mobile)
  const recognition = initSpeechRecognition();

  // Visualizer (mic stream + AudioContext)
  const stream = await initAudioVisualizer();

  // If we can't get the mic, abort. The error toast was shown inside initAudioVisualizer.
  if (!stream) return;

  // Even without speech API we still record the waveform — transcript via fallback input
  AppState.update({
    isRecording:      true,
    transcript:       '',
    recordingSeconds: 0,
    recognition,
  });
  AppState.set('sessionId', `session_${Date.now()}`);

  // UI updates
  el('micRing')?.classList.add('recording');
  if (el('micStatus')) el('micStatus').textContent = SPEECH_SUPPORTED ? 'Listening…' : 'Recording…';
  el('recTimer')?.classList.remove('hidden');
  updateTranscription('');

  // Start speech recognition
  if (recognition) {
    const lang    = el('langSelect')?.value || 'en';
    const langMap = {
      en: 'en-US', fr: 'fr-FR', es: 'es-ES', de: 'de-DE',
      ja: 'ja-JP', zh: 'zh-CN', it: 'it-IT', pt: 'pt-BR'
    };
    recognition.lang = langMap[lang] || 'en-US';
    try {
      recognition.start();
    } catch (err) {
      // Already started or other transient error — ignore
      console.warn('[Speech] recognition.start() failed:', err.message);
    }
  }

  // Timer
  const timer = setInterval(() => {
    const secs = AppState.get('recordingSeconds') + 1;
    AppState.set('recordingSeconds', secs);
    if (el('recTimer')) el('recTimer').textContent = formatDuration(secs);
    if (secs >= 120) stopRecording(); // auto-stop at 2 minutes
  }, 1000);
  AppState.set('recordingTimer', timer);
};

const stopRecording = () => {
  const recognition  = AppState.get('recognition');
  const timer        = AppState.get('recordingTimer');
  const stream       = AppState.get('micStream');
  const audioContext = AppState.get('audioContext');

  if (recognition)  { try { recognition.stop(); } catch { /* ignore */ } }
  if (timer)        clearInterval(timer);
  if (stream)       stream.getTracks().forEach(t => t.stop());
  if (audioContext) audioContext.close().catch(() => {});

  AppState.update({
    isRecording:  false,
    micStream:    null,
    audioContext: null,
    analyser:     null,
    recognition:  null,
  });

  el('micRing')?.classList.remove('recording');
  if (el('micStatus')) el('micStatus').textContent = 'Tap to speak';
  el('recTimer')?.classList.add('hidden');

  const transcript = AppState.get('transcript');
  if (el('analyzeBtn')) el('analyzeBtn').disabled = !transcript.trim();
};

// ─── Mic Button ───────────────────────────────────────────────────────────────
const initMicButton = () => {
  // Show fallback text input on iOS where Speech API is unavailable
  if (!SPEECH_SUPPORTED) {
    showMobileFallbackInput();
  }

  const micBtn = el('micBtn');
  if (!micBtn) return;

  // Toggle on click (works on desktop and Android)
  micBtn.addEventListener('click', () => {
    if (AppState.get('isRecording')) stopRecording();
    else startRecording();
  });

  // Touch events for mobile (prevent ghost clicks)
  micBtn.addEventListener('touchstart', (e) => {
    e.preventDefault(); // prevent the synthetic 'click' that fires 300ms later
    if (!AppState.get('isRecording')) startRecording();
  }, { passive: false });

  micBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    // On mobile with continuous=false we stop after each utterance automatically,
    // but user can also manually tap again to stop.
    // Only stop if they tapped while already recording AND on mobile.
    if (IS_MOBILE && AppState.get('isRecording')) stopRecording();
  }, { passive: false });

  el('langSelect')?.addEventListener('change', async () => {
    if (AppState.get('isRecording')) stopRecording();
    if (window.DailyPhrases) await DailyPhrases.setLanguage(el('langSelect').value);
  });

  el('newPhraseBtn')?.addEventListener('click', loadNewPhrase);
};

const loadNewPhrase = () => {
  if (window.DailyPhrases) { DailyPhrases.randomPhrase(); return; }
  const lang = el('langSelect')?.value || 'en';
  const fallback = {
    en: [{ text: 'Hello, how are you today?',       phonetic: '/hɛˈloʊ haʊ ɑːr juː təˈdeɪ/' }],
    fr: [{ text: 'Bonjour, comment allez-vous?',    phonetic: '/bɔ̃.ʒuʁ kɔ.mɑ̃ a.le vu/' }],
    es: [{ text: 'Buenos días, ¿cómo estás?',       phonetic: '/ˈbwenos ˈdias ˈkomo esˈtas/' }],
    de: [{ text: 'Guten Morgen, wie geht es?',      phonetic: '/ˈɡuːtn̩ ˈmɔʁɡn̩ viː ɡeːt ʔɛs/' }],
    ja: [{ text: 'おはようございます',              phonetic: '/o.ha.yoː.ɡo.za.i.ma.su/' }],
    zh: [{ text: '你好，你今天怎么样？',             phonetic: '/nǐ hǎo nǐ jīntiān zěnme yàng/' }],
    it: [{ text: 'Buongiorno, come sta?',            phonetic: '/ˌbwɔnˈdʒorno ˈkome ˈsta/' }],
    pt: [{ text: 'Bom dia, como vai você?',          phonetic: '/bõ ˈdʒiɐ ˈkõmu ˈvaj voˈse/' }],
  };
  const phrases = fallback[lang] || fallback.en;
  const phrase  = phrases[Math.floor(Math.random() * phrases.length)];
  if (el('phraseText'))    el('phraseText').textContent    = phrase.text;
  if (el('phrasePhonetic')) el('phrasePhonetic').textContent = phrase.phonetic;
  AppState.set('transcript', '');
  updateTranscription('');
  if (el('analyzeBtn')) el('analyzeBtn').disabled = true;
};

// ─── Demo / Fallback Results ──────────────────────────────────────────────────
const getDemoResults = () => ({
  overallAccuracy: 72, fluencyScore: 68, intonationScore: 75, stressScore: 65,
  wordsBreakdown: [
    { word: 'Hello', score: 90, status: 'correct', note: null },
    { word: 'world', score: 60, status: 'close',   note: 'Try emphasizing the vowel sound' },
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
    // Auto-stop recording so the last chunk finalises
    if (AppState.get('isRecording')) {
      stopRecording();
      await new Promise(r => setTimeout(r, 350));
    }

    const transcript = AppState.get('transcript');
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

    const btn     = el('analyzeBtn');
    const spinner = btn?.querySelector('.btn-spinner');
    if (btn)     btn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    try {
      const language  = el('langSelect')?.value || 'en';
      const sessionId = AppState.get('sessionId');
      const duration  = AppState.get('recordingSeconds');

      const res = await ApiClient.speech.analyze({
        targetText, transcribedText: transcript, language, sessionId,
      });
      const data = res.data;
      AppState.update({ analyzeData: data });

      const history = AppState.get('accuracyHistory');
      history.push({ date: new Date().toLocaleDateString(), accuracy: data.overallAccuracy });
      if (history.length > 10) history.shift();

      renderResults(data);

      const words   = transcript.split(' ').length;
      const correct = Math.round(words * (data.overallAccuracy / 100));
      await ApiClient.sessions.create({
        language, duration, accuracy: data.overallAccuracy,
        wordsAttempted: words, wordsCorrect: correct,
        transcript, feedback: data.suggestions?.join('; '),
      }).catch(() => {});

      showToast(`Analysis complete! Score: ${data.overallAccuracy}%`, 'success');

    } catch (err) {
      console.error('[Analyze] Error:', err);
      showToast(err.message || 'Analysis failed. Check your connection.', 'error');
      renderResults(getDemoResults());
    } finally {
      if (btn)     btn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
    }
  });
};

// ─── Render Results ───────────────────────────────────────────────────────────
const renderResults = (data) => {
  const emptyEl   = el('resultsEmpty');
  const contentEl = el('resultsContent');
  if (emptyEl)   { emptyEl.classList.add('hidden');    emptyEl.style.display   = 'none'; }
  if (contentEl) { contentEl.classList.remove('hidden'); contentEl.style.display = 'block'; }

  // Scroll results panel into view on mobile
  el('resultsPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  drawScoreRing(data.overallAccuracy);
  if (el('overallScore')) el('overallScore').textContent = data.overallAccuracy + '%';

  const scores = [
    { bar: 'fluencyBar',    num: 'fluencyNum',    val: data.fluencyScore    ?? 0 },
    { bar: 'intonationBar', num: 'intonationNum', val: data.intonationScore ?? 0 },
    { bar: 'stressBar',     num: 'stressNum',     val: data.stressScore     ?? 0 },
  ];
  scores.forEach(({ bar, num, val }) => {
    const barEl = el(bar), numEl = el(num);
    if (barEl) {
      setTimeout(() => { barEl.style.width = val + '%'; }, 100);
      barEl.style.background = val >= 80
        ? 'linear-gradient(90deg,#7FFFD4,#00B4D8)'
        : val >= 60
          ? 'linear-gradient(90deg,#FFD166,#FF9B42)'
          : 'linear-gradient(90deg,#FF6B6B,#FF4757)';
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
  const color  = score >= 80 ? '#7FFFD4' : score >= 60 ? '#FFD166' : '#FF6B6B';

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
  const canvas  = el('miniTrendChart');
  if (!canvas) return;
  const history = AppState.get('accuracyHistory');
  if (!history.length) return;

  const existing = AppState.get('charts').miniTrend;
  if (existing) existing.destroy();

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels:   history.map(h => h.date),
      datasets: [{
        data:               history.map(h => h.accuracy),
        borderColor:        '#7FFFD4',
        backgroundColor:    'rgba(127,255,212,0.08)',
        borderWidth:        2,
        pointBackgroundColor: '#7FFFD4',
        pointRadius:        4,
        fill:               true,
        tension:            0.4,
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
  let isSpeaking  = false;
  const langCodes = {
    French: 'fr-FR', Spanish: 'es-ES', English: 'en-US',
    German: 'de-DE', Japanese: 'ja-JP', Italian: 'it-IT',
    Portuguese: 'pt-BR', Mandarin: 'zh-CN',
  };

  const convMessages    = el('convMessages');
  const convMicBtn      = el('convMicBtn');
  const convMicRing     = el('convMicRing');
  const convMicLabel    = el('convMicLabel');
  const convSendBtn     = el('convSendBtn');
  const convTextInput   = el('convTextInput');
  const convLangSelect  = el('convLang');
  const convScoreBar    = el('convScoreBar');
  const convScoreFill   = el('convScoreFill');
  const convScoreNum    = el('convScoreNum');
  const convEncourage   = el('convEncouragement');
  const convAiSpeak     = el('convAiSpeaking');

  const addMessage = (role, text, translation = null, correction = null) => {
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.className = `conv-msg ${isUser ? 'user' : 'ai'}`;
    div.innerHTML = `
      <div class="conv-avatar">${isUser ? '🧑' : '🤖'}</div>
      <div class="conv-bubble">
        <div class="conv-text">${text}</div>
        ${translation ? `<div class="conv-translation">📖 ${translation}</div>` : ''}
        ${correction  ? `<div class="conv-correction">✏️ ${correction}</div>`  : ''}
      </div>
    `;
    convMessages.appendChild(div);
    convMessages.scrollTop = convMessages.scrollHeight;
  };

  const addSuggestion = (correction, encouragement, original) => {
    const list = el('convSuggestionsContent');
    if (!list) return;
    list.querySelector('.suggestions-empty')?.remove();
    if (!correction && !encouragement) return;
    const div = document.createElement('div');
    div.className = 'suggestion-card';
    div.innerHTML = `
      ${original    ? `<div class="suggestion-original">"${original}"</div>`          : ''}
      ${correction  ? `<div class="suggestion-correction">✏️ ${correction}</div>`    : ''}
      ${encouragement ? `<div class="suggestion-encouragement">💡 ${encouragement}</div>` : ''}
    `;
    IS_MOBILE ? list.appendChild(div) : list.prepend(div);
    if (IS_MOBILE) list.scrollTop = list.scrollHeight;
    document.getElementById('convActiveWrapper')?.classList.remove('suggestions-closed');
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
    if (convScoreBar) convScoreBar.style.display = 'flex';
    setTimeout(() => { if (convScoreFill) convScoreFill.style.width = score + '%'; }, 100);
    if (convScoreNum)  convScoreNum.textContent  = score + '%';
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
    window.speechSynthesis.cancel();
    isSpeaking = true;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang   = langCodes[lang] || 'en-US';
    utt.rate   = IS_MOBILE ? 0.8 : 0.85; // slightly slower on mobile for clarity
    utt.pitch  = 1.0;
    utt.volume = 1.0;
    convAiSpeak?.classList.remove('hidden');
    utt.onend  = () => { isSpeaking = false; convAiSpeak?.classList.add('hidden'); };
    utt.onerror = () => { isSpeaking = false; convAiSpeak?.classList.add('hidden'); };
    window.speechSynthesis.speak(utt);
  };

  const sendToAI = async (userText) => {
    if (!userText.trim()) return;
    addMessage('user', userText);
    convHistory.push({ role: 'user', text: userText });
    const systemPrompt = window.ConvSettings
      ? ConvSettings.getSystemContext()
      : `You are an AI language tutor. Respond in ${convLangSelect?.value || 'English'}.`;
    showLoadingBubble();
    try {
      const API = window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'https://linguawave-backend-qk64.onrender.com';
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
      const fallback = getDemoReply(convLangSelect?.value);
      addMessage('ai', fallback.reply, fallback.translation, fallback.correction);
      convHistory.push({ role: 'ai', text: fallback.reply });
      updateScore(fallback.score, fallback.encouragement);
      speakText(fallback.reply, convLangSelect?.value || 'English');
      addSuggestion(fallback.correction, fallback.encouragement, userText);
    }
  };

  const getDemoReply = (lang) => {
    const replies = {
      French:   { reply: "C'est très bien! Continuez à pratiquer.", translation: "That's very good! Keep practicing.", correction: null, score: 72 + Math.floor(Math.random() * 20), encouragement: 'Great effort! 🌟' },
      Spanish:  { reply: '¡Muy bien! Sigue practicando tu español.',  translation: 'Very good! Keep practicing.',        correction: null, score: 75 + Math.floor(Math.random() * 20), encouragement: 'Excellent! 🎉' },
      German:   { reply: 'Sehr gut! Weiter so!',                       translation: 'Very good! Keep it up!',            correction: null, score: 70 + Math.floor(Math.random() * 20), encouragement: 'Wunderbar! 🌟' },
    };
    return replies[lang] || replies.French;
  };

  // ── Conversation mic (push-to-talk on mobile, click-to-toggle on desktop) ──
  const startConvRecording = () => {
    if (!SPEECH_SUPPORTED) {
      showToast('Speech not supported on this browser. Please type your message.', 'info');
      convTextInput?.focus();
      return;
    }
    if (isSpeaking) window.speechSynthesis.cancel();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    convRecognition = new SR();
    convRecognition.lang         = langCodes[convLangSelect?.value] || 'en-US';
    convRecognition.continuous   = false;
    convRecognition.interimResults = false;
    convRecognition.onstart  = () => { convRecording = true; convMicRing?.classList.add('recording'); if (convMicLabel) convMicLabel.textContent = 'Listening…'; };
    convRecognition.onresult = (e) => { const text = e.results[0][0].transcript; if (convTextInput) convTextInput.value = text; sendToAI(text); };
    convRecognition.onend    = () => { convRecording = false; convMicRing?.classList.remove('recording'); if (convMicLabel) convMicLabel.textContent = 'Hold to speak'; };
    convRecognition.onerror  = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') showToast(`Mic error: ${e.error}`, 'error');
      convRecording = false; convMicRing?.classList.remove('recording');
      if (convMicLabel) convMicLabel.textContent = 'Hold to speak';
    };
    try { convRecognition.start(); } catch { /* already running */ }
  };

  const stopConvRecording = () => {
    try { convRecognition?.stop(); } catch { /* ignore */ }
    convRecording = false;
    convMicRing?.classList.remove('recording');
    if (convMicLabel) convMicLabel.textContent = 'Hold to speak';
  };

  // Desktop: mousedown/mouseup push-to-talk
  convMicBtn?.addEventListener('mousedown', startConvRecording);
  convMicBtn?.addEventListener('mouseup',   stopConvRecording);
  convMicBtn?.addEventListener('mouseleave', stopConvRecording);

  // Mobile: touchstart/touchend push-to-talk (prevents 300ms ghost click)
  convMicBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); startConvRecording(); }, { passive: false });
  convMicBtn?.addEventListener('touchend',   (e) => { e.preventDefault(); stopConvRecording();  }, { passive: false });

  // Fallback click toggle (catches cases touch events don't fire)
  convMicBtn?.addEventListener('click', () => {
    if (!convRecording) startConvRecording(); else stopConvRecording();
  });

  convSendBtn?.addEventListener('click', () => {
    const t = convTextInput?.value.trim();
    if (t) { sendToAI(t); if (convTextInput) convTextInput.value = ''; }
  });

  convTextInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const t = convTextInput.value.trim();
      if (t) { sendToAI(t); convTextInput.value = ''; }
    }
  });

  el('resetConvBtn')?.addEventListener('click', () => {
    convHistory = [];
    window.speechSynthesis.cancel();
    if (convMessages) convMessages.innerHTML = `
      <div class="conv-msg ai">
        <div class="conv-avatar">🤖</div>
        <div class="conv-bubble">
          <div class="conv-text">New conversation started! Ready when you are!</div>
        </div>
      </div>`;
    if (convScoreBar) convScoreBar.style.display = 'none';
    if (window.ScoreChart) ScoreChart.reset();
    if (convScoreFill) convScoreFill.style.width = '0%';
    const list = el('convSuggestionsContent');
    if (list) list.innerHTML = `<div class="suggestions-empty"><div class="empty-icon">📝</div><p>Start chatting to see language suggestions here.</p></div>`;
    document.getElementById('convActiveWrapper')?.classList.remove('suggestions-closed');
  });

  const closeBtn = document.getElementById('closeSuggestionsBtn');
  const wrapper  = document.getElementById('convActiveWrapper');
  if (closeBtn && wrapper) closeBtn.addEventListener('click', () => wrapper.classList.add('suggestions-closed'));
};

const adaptConversationForMobile = () => {};
let convInitialized = false;

// ─── Progress Charts ──────────────────────────────────────────────────────────
let chartsLoaded = false;
const loadProgressCharts = async () => {
  if (chartsLoaded) return;
  chartsLoaded = true;

  Chart.defaults.color       = 'rgba(240,244,255,0.5)';
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

  const mkAccChart = () => {
    const c = el('accuracyChart'); if (!c) return;
    Chart.getChart(c)?.destroy();
    new Chart(c, {
      type: 'line',
      data: { labels: trendData.map(d => d._id), datasets: [{ label: 'Accuracy %', data: trendData.map(d => Math.round(d.avgAccuracy)), borderColor: '#7FFFD4', backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 160); g.addColorStop(0, 'rgba(127,255,212,0.18)'); g.addColorStop(1, 'rgba(127,255,212,0)'); return g; }, borderWidth: 2.5, pointBackgroundColor: '#7FFFD4', pointRadius: IS_MOBILE ? 3 : 4, fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0d1120', borderColor: 'rgba(127,255,212,.2)', borderWidth: 1 } }, scales: { x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { maxTicksLimit: IS_MOBILE ? 4 : 7, font: { size: 11 } } }, y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.04)' }, ticks: { callback: v => v + '%', font: { size: 11 } } } } },
    });
  };
  mkAccChart();

  const radarC = el('radarChart');
  if (radarC) { Chart.getChart(radarC)?.destroy(); new Chart(radarC, { type: 'radar', data: { labels: ['Accuracy', 'Fluency', 'Intonation', 'Stress', 'Vocab', 'Rhythm'], datasets: [{ label: 'Your Skills', data: [75, 68, 72, 65, 80, 70], backgroundColor: 'rgba(127,255,212,0.08)', borderColor: '#7FFFD4', pointBackgroundColor: '#7FFFD4', borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.08)' }, ticks: { display: false }, pointLabels: { color: 'rgba(240,244,255,.6)', font: { size: IS_MOBILE ? 9 : 11 } } } } } }); }

  const barC = el('sessionsBarChart');
  if (barC) { Chart.getChart(barC)?.destroy(); new Chart(barC, { type: 'bar', data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{ label: 'Sessions', data: [2, 3, 1, 4, 2, 5, 3], backgroundColor: (ctx) => { const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, 'rgba(127,255,212,0.8)'); g.addColorStop(1, 'rgba(0,180,216,0.3)'); return g; }, borderRadius: 8, borderSkipped: false }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { stepSize: 1 } } } } }); }

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
    const lb  = res.data?.leaderboard || [];
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
  const SERVER_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:5000'
    : 'https://linguawave-backend-qk64.onrender.com';
  let socket;
  try {
    socket = io(SERVER_URL, { auth: { token: ApiClient.getToken() }, transports: ['websocket', 'polling'] });
    AppState.set('socket', socket);
  } catch { showToast('Could not connect to chat server', 'error'); return; }

  socket.on('connect',       () => { socket.emit('chat:join', AppState.get('currentRoom')); loadChatMessages(AppState.get('currentRoom')); });
  socket.on('users:online',  (count) => { if (el('onlineCount')) el('onlineCount').textContent = count; });
  socket.on('chat:message',  (msg)   => appendChatMessage(msg));
  socket.on('chat:userJoined', (data) => appendSystemMessage(`${data.username} joined the room`));
  socket.on('chat:typing',   ({ username, isTyping }) => {
    const indicator = el('typingIndicator'), typingUser = el('typingUser');
    if (indicator && typingUser) { typingUser.textContent = `${username} is typing`; indicator.classList.toggle('hidden', !isTyping); }
  });
  socket.on('disconnect', () => showToast('Disconnected from chat', 'error'));
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
  const user   = AppState.get('user');
  const isOwn  = msg.user?.id === user?.id || msg.userId === user?.id;
  const username = msg.user?.username || 'Anonymous';
  const time   = new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  container.querySelector('.chat-loading')?.remove();
  const msgEl  = document.createElement('div');
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

const initCloudNotification = () => {
  const notif = el('signflowNotification');
  const close = el('closeNotification');
  if (!notif || !close) return;

  // Don't show if user closed it before
  if (localStorage.getItem('signflow_meet_notif_closed')) return;

  // Show automatically with a slight delay
  setTimeout(() => {
    notif.classList.remove('hidden');
  }, 1500);

  close.addEventListener('click', () => {
    notif.classList.add('fade-out');
    // Store in localStorage
    localStorage.setItem('signflow_meet_notif_closed', 'true');
    // Remove from DOM after animation
    setTimeout(() => {
      notif.classList.add('hidden');
    }, 500);
  });
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = await bootstrapAuth();
  if (!user) return;

  initNavigation();
  initUserInfo();
  initMicButton();
  initAnalyzeButton();
  initSessionFilters();
  initCloudNotification();
  drawLiveWave();
});