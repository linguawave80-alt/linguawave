// public/js/dailyPhrases.js
// ─────────────────────────────────────────────────────────────────────────────
// Daily Phrases Module — Groq-powered practice phrase system
//
// Fetches fresh AI-generated phrases from /api/v1/phrases/daily
// Renders a beautiful phrase carousel with topic tags, translations, and tips
// Integrates with the Practice page mic/analyze flow in dashboard.js
//
// Exposes: window.DailyPhrases
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const DailyPhrases = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let _phrases     = [];
  let _currentIdx  = 0;
  let _lang        = 'en';
  let _difficulty  = 'intermediate';
  let _isLoading   = false;
  let _lastFetched = null; // ISO string

  // Map lang select values to API params
  const LANG_MAP = {
    en: 'en', fr: 'fr', es: 'es', de: 'de',
    ja: 'ja', zh: 'zh', it: 'it', pt: 'pt',
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  const $  = (id)  => document.getElementById(id);
  const $$ = (sel) => document.querySelector(sel);

  // ── Fetch phrases from backend ────────────────────────────────────────────
  const fetchPhrases = async (forceRefresh = false) => {
    if (_isLoading) return;
    _isLoading = true;

    _showLoadingState();

    try {
      const token  = window.ApiClient ? window.ApiClient.getToken() : '';
      const params = new URLSearchParams({
        lang:       _lang,
        difficulty: _difficulty,
        ...(forceRefresh ? { refresh: '1' } : {}),
      });

      const BASE_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000/api/v1' : 'https://linguawave-backend-qk64.onrender.com/api/v1';
      const res = await fetch(
        `${BASE_URL}/phrases/daily?${params}`,
        {
          headers: {
            'Content-Type':  'application/json',
            
            'Authorization': `Bearer ${token}`,
          },
          credentials: 'include',
        }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      if (data.success && data.data.phrases?.length) {
        _phrases    = data.data.phrases;
        _currentIdx = 0;
        _lastFetched = data.data.generatedAt;
        _renderCurrentPhrase();
        _renderPhraseNav();
        _showPhraseCard();

        // Show "fresh" badge if just generated (not from cache)
        if (!data.data.cached && forceRefresh) {
          _showFreshBadge();
        }

        // Update next-refresh indicator
        _updateRefreshTimer(data.data.nextRefresh);

        console.info(
          `[DailyPhrases] Loaded ${_phrases.length} phrases for ${data.data.language}` +
          ` (${data.data.provider || 'api'}, cached: ${data.data.cached})`
        );
      } else {
        throw new Error('Empty phrase response');
      }
    } catch (err) {
      console.error('[DailyPhrases] Fetch failed:', err.message);
      _loadFallbackPhrases();
    } finally {
      _isLoading = false;
    }
  };

  // ── Fallback phrases (client-side safety net) ────────────────────────────
  const FALLBACK = {
    en: [
      { text: 'Hello, how are you today?', phonetic: '/hɛˈloʊ haʊ ɑːr juː təˈdeɪ/', topic: 'Greetings', translation: 'A standard friendly greeting', tip: 'Stress "hel-LO" with a rising tone.' },
      { text: 'Could you please repeat that?', phonetic: '/kʊd juː pliːz rɪˈpiːt ðæt/', topic: 'Communication', translation: 'Asking someone to say something again', tip: 'Link "could-you" smoothly.' },
      { text: 'The weather is beautiful today.', phonetic: '/ðə ˈwɛðər ɪz ˈbjuːtɪfəl təˈdeɪ/', topic: 'Small Talk', translation: 'Commenting on nice weather', tip: 'The "th" in "the" is voiced — tongue to upper teeth.' },
      { text: 'I would like to order a coffee.', phonetic: '/aɪ wʊd laɪk tuː ˈɔːrdər ə ˈkɒfi/', topic: 'Food & Drink', translation: 'Ordering at a café', tip: '"Would like" is more polite than "want".' },
      { text: 'Excuse me, where is the nearest train station?', phonetic: '/ɪkˈskjuːz miː wɛr ɪz ðə ˈnɪərɪst treɪn ˈsteɪʃən/', topic: 'Travel', translation: 'Asking for directions to the station', tip: 'Stress "EX-cuse" on the second syllable when verb.' },
    ],
    fr: [
      { text: 'Bonjour, comment allez-vous?', phonetic: '/bɔ̃.ʒuʁ kɔ.mɑ̃ a.le vu/', topic: 'Greetings', translation: 'Good day, how are you? (formal)', tip: 'Nasal vowel in "bon" — do not pronounce the N separately.' },
      { text: 'Je voudrais un café au lait, s\'il vous plaît.', phonetic: '/ʒə vu.dʁɛ œ̃ ka.fe o lɛ sil vu plɛ/', topic: 'Food', translation: 'I would like a coffee with milk, please.', tip: 'Liaison: "s\'il vous plaît" flows as one phrase.' },
      { text: 'Où se trouve la gare la plus proche?', phonetic: '/u sə tʁuv la ɡaʁ la ply pʁɔʃ/', topic: 'Travel', translation: 'Where is the nearest train station?', tip: 'French R is uvular — vibrate the back of your throat.' },
    ],
    es: [
      { text: 'Buenos días, ¿cómo está usted?', phonetic: '/ˈbwenos ˈdias ˈkomo esˈta usˈteð/', topic: 'Greetings', translation: 'Good morning, how are you? (formal)', tip: '"Usted" ends with a soft "d" — like English "th" in "the".' },
      { text: '¿Me puede decir cómo llegar al museo?', phonetic: '/me ˈpweðe ðe.ˈθiɾ ˈkomo ʎeˈɣaɾ al muˈseo/', topic: 'Travel', translation: 'Can you tell me how to get to the museum?', tip: '"Ll" sounds like English "y" in Latin America.' },
      { text: 'Quisiera reservar una mesa para dos personas.', phonetic: '/kiˈsjera reseɾˈβaɾ ˈuna ˈmesa ˈpaɾa ðos peɾˈsonas/', topic: 'Restaurant', translation: 'I would like to reserve a table for two people.', tip: '"Quisiera" (imperfect subjunctive) is the polite form of "want".' },
    ],
    ja: [
      { text: 'こんにちは、お元気ですか？', phonetic: '/konnichiwa o-genki desu ka/', topic: 'Greetings', translation: 'Hello, how are you?', tip: 'Use a polite tone; Japanese often omits subjects.' },
      { text: 'すみません、駅はどこですか？', phonetic: '/sumimasen, eki wa doko desu ka?/', topic: 'Travel', translation: 'Excuse me, where is the station?', tip: 'Say "sumimasen" for attention politely.' },
      { text: 'コーヒーを一つお願いします。', phonetic: '/koohii o hitotsu onegaishimasu/', topic: 'Food & Drink', translation: 'One coffee, please.', tip: 'Politeness marker "onegaishimasu" makes requests softer.' },
    ],
    zh: [
      { text: '你好，你今天怎么样？', phonetic: '/nǐ hǎo, nǐ jīn tiān zěn me yàng?/', topic: 'Greetings', translation: 'Hello, how are you today?', tip: 'Mandarin tones change meaning — practice the tones.' },
      { text: '请问，火车站在哪里？', phonetic: '/qǐng wèn, huǒ chē zhàn zài nǎ lǐ?/', topic: 'Travel', translation: 'Excuse me, where is the train station?', tip: 'Start with "qǐng wèn" to be polite.' },
      { text: '我要一杯咖啡。', phonetic: '/wǒ yào yì bēi kā fēi/', topic: 'Food & Drink', translation: 'I would like a cup of coffee.', tip: '"Wǒ yào" is direct; soften with "qǐng" for politeness.' },
    ],
    it: [
      { text: 'Buongiorno, come sta?', phonetic: '/bwonˈdʒorno ˈkome sta/', topic: 'Greetings', translation: 'Good morning, how are you? (formal)', tip: 'Use formal "Lei" forms for politeness.' },
      { text: 'Dov&#39;è la stazione più vicina?', phonetic: '/doˈve la staˈtsjone pju ˈvitʃina/', topic: 'Travel', translation: 'Where is the nearest station?', tip: 'Stress the vowel sounds clearly.' },
      { text: 'Vorrei ordinare un caffè, per favore.', phonetic: '/vorˈrei ordiˈnare un kafˈfɛ per faˈvore/', topic: 'Food & Drink', translation: 'I would like to order a coffee, please.', tip: '"Per favore" is the standard please.' },
    ],
    pt: [
      { text: 'Olá, como você está hoje?', phonetic: '/oˈla ˈkomu voˈse esˈta ʒoʒi/', topic: 'Greetings', translation: 'Hello, how are you today?', tip: 'Brazilian Portuguese has softer "r" sounds.' },
      { text: 'Com licença, onde fica a estação?', phonetic: '/kõ liˈsẽsɐ ˈõdʒi ˈfikɐ a isˈtɐ̃w/', topic: 'Travel', translation: 'Excuse me, where is the station?', tip: 'Use "com licença" to get attention politely.' },
      { text: 'Quero um café, por favor.', phonetic: '/ˈkɛɾu ũ kaˈfɛ poʁ faˈvoɾ/', topic: 'Food & Drink', translation: 'I want a coffee, please.', tip: '"Por favor" is the common please.' },
    ],
  };

  const _loadFallbackPhrases = () => {
    const lang = _lang in FALLBACK ? _lang : 'en';
    _phrases    = FALLBACK[lang];
    _currentIdx = 0;
    _renderCurrentPhrase();
    _renderPhraseNav();
    _showPhraseCard();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const _renderCurrentPhrase = () => {
    if (!_phrases.length) return;
    const phrase = _phrases[_currentIdx];

    // Core phrase fields (always present)
    const phraseText = $('phraseText');
    const phrasePhonetic = $('phrasePhonetic');
    if (phraseText) phraseText.textContent = phrase.text;
    if (phrasePhonetic) phrasePhonetic.textContent = phrase.phonetic || '';

    // Topic tag
    const topicTag = $('phraseTopicTag');
    if (topicTag) topicTag.textContent = phrase.topic || 'General';

    // Translation (expandable)
    const transEl = $('phraseTranslation');
    if (transEl) {
      transEl.textContent = phrase.translation || '';
      transEl.parentElement?.classList.toggle('hidden', !phrase.translation);
    }

    // Tip
    const tipEl = $('phraseTip');
    if (tipEl) {
      tipEl.textContent = phrase.tip ? `💡 ${phrase.tip}` : '';
      tipEl.classList.toggle('hidden', !phrase.tip);
    }

    // Difficulty badge
    const diffBadge = $('phraseDiffBadge');
    if (diffBadge) {
      const icons = { beginner: '🌱', intermediate: '⚡', advanced: '🔥' };
      diffBadge.textContent = `${icons[phrase.difficulty] || '⚡'} ${phrase.difficulty || _difficulty}`;
      diffBadge.dataset.level = phrase.difficulty || _difficulty;
    }

    // Counter
    const counter = $('phraseCounter');
    if (counter) counter.textContent = `${_currentIdx + 1} / ${_phrases.length}`;

    // Update active dot in nav
    document.querySelectorAll('.phrase-nav-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === _currentIdx);
    });

    // Animate in
    const phraseBox = $$('.phrase-box');
    if (phraseBox) {
      phraseBox.classList.remove('phrase-animate-in');
      void phraseBox.offsetWidth; // force reflow
      phraseBox.classList.add('phrase-animate-in');
    }

    // Sync the main dashboard state so analyze button works
    if (window.AppState) AppState.set('transcript', '');
    const analyzeBtn = $('analyzeBtn');
    if (analyzeBtn) analyzeBtn.disabled = true;
    const transText = $('transText');
    if (transText) transText.innerHTML = '<span class="trans-placeholder">Start speaking to see transcription…</span>';
  };

  const _renderPhraseNav = () => {
    const nav = $('phraseNavDots');
    if (!nav) return;
    nav.innerHTML = _phrases.map((_, i) => `
      <button class="phrase-nav-dot ${i === _currentIdx ? 'active' : ''}"
              data-idx="${i}" aria-label="Phrase ${i + 1}"></button>
    `).join('');

    nav.querySelectorAll('.phrase-nav-dot').forEach(dot => {
      dot.addEventListener('click', () => goToPhrase(parseInt(dot.dataset.idx)));
    });
  };

  const _showLoadingState = () => {
    const phraseText = $('phraseText');
    const phraseBox = $$('.phrase-box');
    if (phraseText) phraseText.innerHTML = `
      <span class="phrase-loading-text">
        <span class="phrase-loader-dot"></span>
        <span class="phrase-loader-dot"></span>
        <span class="phrase-loader-dot"></span>
        Generating phrases with AI…
      </span>
    `;
    if (phraseBox) phraseBox.classList.add('is-loading');
    const phonetic = $('phrasePhonetic');
    if (phonetic) phonetic.textContent = '';
  };

  const _showPhraseCard = () => {
    const phraseBox = $$('.phrase-box');
    if (phraseBox) phraseBox.classList.remove('is-loading');
  };

  const _showFreshBadge = () => {
    const badge = $('phraseFreshBadge');
    if (!badge) return;
    badge.classList.remove('hidden');
    badge.classList.add('badge-pop');
    setTimeout(() => {
      badge.classList.remove('badge-pop');
      badge.classList.add('hidden');
    }, 3500);
  };

  const _updateRefreshTimer = (nextRefreshISO) => {
    const el = $('phraseRefreshTime');
    if (!el || !nextRefreshISO) return;
    const next = new Date(nextRefreshISO);
    const now  = new Date();
    const hoursLeft = Math.max(0, Math.ceil((next - now) / 3600000));
    el.textContent = hoursLeft <= 1 ? 'Refreshes in < 1 hour' : `Refreshes in ~${hoursLeft}h`;
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const nextPhrase = () => {
    if (!_phrases.length) return;
    _currentIdx = (_currentIdx + 1) % _phrases.length;
    _renderCurrentPhrase();
  };

  const prevPhrase = () => {
    if (!_phrases.length) return;
    _currentIdx = (_currentIdx - 1 + _phrases.length) % _phrases.length;
    _renderCurrentPhrase();
  };

  const goToPhrase = (idx) => {
    if (idx < 0 || idx >= _phrases.length) return;
    _currentIdx = idx;
    _renderCurrentPhrase();
  };

  const randomPhrase = () => {
    if (!_phrases.length) return;
    let newIdx;
    do { newIdx = Math.floor(Math.random() * _phrases.length); }
    while (newIdx === _currentIdx && _phrases.length > 1);
    _currentIdx = newIdx;
    _renderCurrentPhrase();
  };

  // ── Public: update language / difficulty and re-fetch ────────────────────
  const setLanguage = async (lang) => {
    if (lang === _lang) return;
    _lang = LANG_MAP[lang] || 'en';
    _phrases = [];
    await fetchPhrases();
  };

  const setDifficulty = async (level) => {
    if (level === _difficulty) return;
    _difficulty = level;
    _phrases = [];
    await fetchPhrases();
  };

  // ── Get current phrase (for dashboard.js analyze flow) ──────────────────
  const getCurrentPhrase = () =>
    _phrases[_currentIdx] || { text: '', phonetic: '', topic: '', translation: '', tip: '' };

  // ── Init ──────────────────────────────────────────────────────────────────
  const init = () => {
    // New Phrase button
    $('newPhraseBtn')?.addEventListener('click', () => randomPhrase());

    // Prev / Next arrows
    $('phrasePrevBtn')?.addEventListener('click', prevPhrase);
    $('phraseNextBtn')?.addEventListener('click', nextPhrase);

    // Refresh (force new AI generation)
    $('phraseRefreshBtn')?.addEventListener('click', async () => {
      const btn = $('phraseRefreshBtn');
      if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
      await fetchPhrases(true);
      if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    });

    // Translation toggle
    $('phraseTranslationToggle')?.addEventListener('click', () => {
      const wrap = $('phraseTranslationWrap');
      if (!wrap) return;
      const isHidden = wrap.classList.toggle('hidden');
      const btn = $('phraseTranslationToggle');
      if (btn) btn.textContent = isHidden ? '🌐 Show translation' : '🙈 Hide translation';
    });

    // Difficulty pills in Practice page
    document.querySelectorAll('.practice-diff-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        document.querySelectorAll('.practice-diff-pill')
          .forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        await setDifficulty(pill.dataset.level);
      });
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (AppState?.get('currentPage') !== 'practice') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') nextPhrase();
      if (e.key === 'ArrowLeft')  prevPhrase();
    });

    // Swipe gesture on phrase box (mobile)
    let touchStartX = 0;
    $$('.phrase-box')?.addEventListener('touchstart', e => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    $$('.phrase-box')?.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) dx < 0 ? nextPhrase() : prevPhrase();
    }, { passive: true });

    // Initial load
    fetchPhrases();
  };

  return {
    init,
    fetchPhrases,
    setLanguage,
    setDifficulty,
    nextPhrase,
    prevPhrase,
    randomPhrase,
    getCurrentPhrase,
  };
})();

// ── Auto-init ──────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', DailyPhrases.init);
} else {
  DailyPhrases.init();
}

window.DailyPhrases = DailyPhrases;
