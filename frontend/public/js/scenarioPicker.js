// frontend/public/js/scenarioPicker.js
// ─────────────────────────────────────────────────────────────────────────────
// Feature 2 + 3: Scenario Picker & Difficulty Level Selector
//
// Exposes: window.ConvSettings  (used by dashboard.js to enrich AI prompts)
// Pattern: mirrors ApiClient's IIFE/closure pattern from api.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const ConvSettings = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let _scenario = {
    key: 'casual',
    prompt: 'Have a casual, friendly conversation. Use natural, everyday language. Be warm and approachable.',
    label: 'Casual Chat',
  };

  let _difficulty = {
    level: 'medium',
    prompt: 'Use normal conversational pace and vocabulary. Balance between simplicity and complexity. Correct mistakes gently.',
  };

  // ── DOM init ─────────────────────────────────────────────────────────────
  const init = () => {
    _bindScenarioCards();
    _bindDifficultyPills();
    _bindStartButton();
    _bindChangeButton();
  };

  const _bindScenarioCards = () => {
    const grid = document.getElementById('scenarioGrid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.scenario-card');
      if (!card) return;

      // Deactivate all
      grid.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('active'));

      // Activate clicked
      card.classList.add('active');

      _scenario = {
        key: card.dataset.scenario,
        prompt: card.dataset.prompt,
        label: card.querySelector('.scenario-name')?.textContent || card.dataset.scenario,
      };

      // Animate — subtle scale bounce
      card.animate([
        { transform: 'scale(0.96)' },
        { transform: 'scale(1.03)' },
        { transform: 'scale(1.0)' },
      ], { duration: 280, easing: 'ease' });

      // If a conversation is active, notify via custom event so dashboard.js
      // can optionally inject a context-change note into the chat
      document.dispatchEvent(new CustomEvent('lw:scenarioChanged', {
        detail: { ..._scenario },
      }));
    });
  };

  const _bindDifficultyPills = () => {
    const container = document.getElementById('difficultyPills');
    if (!container) return;

    container.addEventListener('click', (e) => {
      const pill = e.target.closest('.diff-pill');
      if (!pill) return;

      container.querySelectorAll('.diff-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      _difficulty = {
        level: pill.dataset.level,
        prompt: pill.dataset.prompt,
      };

      pill.animate([
        { transform: 'scale(0.93)' },
        { transform: 'scale(1.04)' },
        { transform: 'scale(1.0)' },
      ], { duration: 220, easing: 'ease' });

      document.dispatchEvent(new CustomEvent('lw:difficultyChanged', {
        detail: { ..._difficulty },
      }));
    });
  };

  // ── Setup panel collapse / expand ────────────────────────────────────────

  const _bindStartButton = () => {
    const btn = document.getElementById('startConvBtn');
    if (!btn) return;
    btn.addEventListener('click', _startConversation);
  };

  const _bindChangeButton = () => {
    const btn = document.getElementById('badgeChangeBtn');
    if (!btn) return;
    btn.addEventListener('click', _showSetup);
  };

  const _startConversation = () => {
    const setupPanel = document.getElementById('convSetupPanel');
    const badge = document.getElementById('convSessionBadge');
    const convLayout = document.querySelector('.conv-layout');

    if (!setupPanel) return;

    // Update badge text with current selections
    const lang = document.getElementById('convLang')?.value || 'English';
    const scenarioName = document.querySelector('.scenario-card.active .scenario-name')?.textContent || 'Casual Chat';
    const scenarioEmoji = document.querySelector('.scenario-card.active .scenario-emoji')?.textContent || '☕';
    const diffPill = document.querySelector('.diff-pill.active');
    const diffIcon = diffPill?.querySelector('.diff-icon')?.textContent || '⚡';
    const diffLevel = diffPill ? (diffPill.dataset.level.charAt(0).toUpperCase() + diffPill.dataset.level.slice(1)) : 'Medium';

    if (badge) {
      document.getElementById('badgeScenario').textContent = `${scenarioEmoji} ${scenarioName}`;
      document.getElementById('badgeDifficulty').textContent = `${diffIcon} ${diffLevel}`;
      document.getElementById('badgeLang').textContent = lang;
    }

    // Collapse setup panel
    setupPanel.classList.add('collapsed');

    // Expand chat layout
    if (convLayout) convLayout.classList.add('chat-active');

    // Show badge after panel collapses
    setTimeout(() => {
      if (badge) badge.classList.remove('hidden');
    }, 420);

    // Fire event so dashboard.js can start a fresh session
    document.dispatchEvent(new CustomEvent('lw:conversationStarted', {
      detail: { scenario: _scenario, difficulty: _difficulty, lang },
    }));
  };

  const _showSetup = () => {
    const setupPanel = document.getElementById('convSetupPanel');
    const badge = document.getElementById('convSessionBadge');
    const convLayout = document.querySelector('.conv-layout');

    if (badge) badge.classList.add('hidden');
    if (setupPanel) setupPanel.classList.remove('collapsed');
    if (convLayout) convLayout.classList.remove('chat-active');
  };

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Build the system-prompt fragment that gets injected into the AI request.
   * Call this from dashboard.js when composing the Gemini/AI payload.
   *
   * @returns {string}  Full context string to prepend to system prompt
   */
  const getSystemContext = () => {
    const lang = document.getElementById('convLang')?.value || 'the target language';
    return [
      `You are an expert ${lang} language tutor having a live practice conversation.`,
      `SCENARIO: ${_scenario.prompt}`,
      `DIFFICULTY: ${_difficulty.prompt}`,
      `Always respond in ${lang}. After each learner reply, briefly note 1 pronunciation or grammar tip in parentheses at the end of your message. Keep responses concise.`,
    ].join('\n');
  };

  /**
   * Returns current selections for logging / API payloads.
   */
  const getState = () => ({
    scenario: { ..._scenario },
    difficulty: { ..._difficulty },
  });

  return { init, getSystemContext, getState };
})();

// ── Auto-init on DOM ready ─────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ConvSettings.init);
} else {
  ConvSettings.init();
}

window.ConvSettings = ConvSettings;