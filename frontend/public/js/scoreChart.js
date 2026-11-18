// frontend/public/js/scoreChart.js
// ─────────────────────────────────────────────────────────────────────────────
// Feature 1: Pronunciation Score Chart (Conversation Page)
//
// Tracks per-turn accuracy + fluency scores during a session.
// Renders a Chart.js line chart inside #convScoreChartPanel.
// Exposes: window.ScoreChart
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const ScoreChart = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let _chart = null;
  let _scores = [];          // [{ accuracy, fluency, label }]
  const MAX_POINTS = 20;     // rolling window

  // ── Chart colours (match CSS variables manually — Chart.js can't read them) ──
  const TEAL  = '#7FFFD4';
  const CYAN  = '#00B4D8';
  const CORAL = '#FF6B6B';
  const SURFACE_2 = 'rgba(255,255,255,.07)';
  const BORDER    = 'rgba(255,255,255,.08)';
  const TEXT_2    = 'rgba(240,244,255,.6)';
  const TEXT_3    = 'rgba(240,244,255,.35)';

  // ── Init ─────────────────────────────────────────────────────────────────
  const init = () => {
    const canvas = document.getElementById('convScoreChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Gradient fill under accuracy line
    const gradAccuracy = ctx.createLinearGradient(0, 0, 0, 120);
    gradAccuracy.addColorStop(0,   'rgba(127,255,212,.25)');
    gradAccuracy.addColorStop(1,   'rgba(127,255,212,.01)');

    const gradFluency = ctx.createLinearGradient(0, 0, 0, 120);
    gradFluency.addColorStop(0,   'rgba(0,180,216,.20)');
    gradFluency.addColorStop(1,   'rgba(0,180,216,.01)');

    _chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Accuracy',
            data: [],
            borderColor: TEAL,
            backgroundColor: gradAccuracy,
            fill: true,
            tension: .45,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: TEAL,
            pointBorderColor: '#050810',
            pointBorderWidth: 2,
            borderWidth: 2,
          },
          {
            label: 'Fluency',
            data: [],
            borderColor: CYAN,
            backgroundColor: gradFluency,
            fill: true,
            tension: .45,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: CYAN,
            pointBorderColor: '#050810',
            pointBorderWidth: 2,
            borderWidth: 2,
            borderDash: [4, 3],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500, easing: 'easeInOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: TEXT_2,
              font: { family: "'DM Sans', sans-serif", size: 11 },
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              usePointStyle: true,
              pointStyleWidth: 10,
              padding: 14,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(9,14,26,.9)',
            borderColor: BORDER,
            borderWidth: 1,
            titleColor: TEXT_2,
            bodyColor: TEXT_2,
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: BORDER, drawTicks: false },
            border: { display: false },
            ticks: {
              color: TEXT_3,
              font: { family: "'DM Sans', sans-serif", size: 10 },
              maxRotation: 0,
              maxTicksLimit: 8,
            },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: BORDER, drawTicks: false },
            border: { display: false },
            ticks: {
              color: TEXT_3,
              font: { family: "'DM Sans', sans-serif", size: 10 },
              stepSize: 25,
              callback: (v) => v + '%',
            },
          },
        },
      },
    });
  };

  // ── Add a new data point ─────────────────────────────────────────────────
  /**
   * @param {number} accuracy  0–100
   * @param {number} fluency   0–100  (can be same as accuracy if not available)
   * @param {string} [label]   optional x-axis label (defaults to "Turn N")
   */
  const addScore = (accuracy, fluency, label) => {
    if (!_chart) init();

    const turnNum = _scores.length + 1;
    const tickLabel = label || `#${turnNum}`;

    _scores.push({ accuracy, fluency, label: tickLabel });

    // Rolling window — keep last MAX_POINTS
    if (_scores.length > MAX_POINTS) _scores.shift();

    // Rebuild datasets
    _chart.data.labels              = _scores.map(s => s.label);
    _chart.data.datasets[0].data   = _scores.map(s => s.accuracy);
    _chart.data.datasets[1].data   = _scores.map(s => s.fluency);
    _chart.update('active');

    // Update meta stats
    _updateMeta();

    // Show panel
    _showPanel();
  };

  // ── Meta stats (avg / best / trend) ─────────────────────────────────────
  const _updateMeta = () => {
    if (_scores.length === 0) return;

    const accuracies = _scores.map(s => s.accuracy);
    const avg  = Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length);
    const best = Math.max(...accuracies);

    // Trend: compare last 3 vs first 3 (if enough data)
    let trendEl = document.getElementById('chartTrend');
    let trendText = 'Trend: --';
    let trendClass = 'trend-neutral';

    if (_scores.length >= 3) {
      const recent = accuracies.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const early  = accuracies.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      const delta  = Math.round(recent - early);

      if (delta > 2) {
        trendText  = `↑ +${delta}%`;
        trendClass = 'trend-positive';
      } else if (delta < -2) {
        trendText  = `↓ ${delta}%`;
        trendClass = 'trend-negative';
      } else {
        trendText  = '→ Steady';
        trendClass = 'trend-neutral';
      }
    }

    const avgEl  = document.getElementById('chartAvgScore');
    const bestEl = document.getElementById('chartBestScore');

    if (avgEl)  avgEl.textContent  = `Avg: ${avg}%`;
    if (bestEl) bestEl.textContent = `Best: ${best}%`;
    if (trendEl) {
      trendEl.textContent = trendText;
      trendEl.className   = `score-chart-stat ${trendClass}`;
    }
  };

  // ── Show / hide panel ────────────────────────────────────────────────────
  const _showPanel = () => {
    const panel = document.getElementById('convScoreChartPanel');
    if (panel && panel.style.display === 'none') {
      panel.style.display = 'block';
    }
  };

  const reset = () => {
    _scores = [];
    if (_chart) {
      _chart.data.labels           = [];
      _chart.data.datasets[0].data = [];
      _chart.data.datasets[1].data = [];
      _chart.update();
    }
    const panel = document.getElementById('convScoreChartPanel');
    if (panel) panel.style.display = 'none';

    const avgEl  = document.getElementById('chartAvgScore');
    const bestEl = document.getElementById('chartBestScore');
    const trendEl = document.getElementById('chartTrend');
    if (avgEl)  avgEl.textContent  = 'Avg: --';
    if (bestEl) bestEl.textContent = 'Best: --';
    if (trendEl) { trendEl.textContent = 'Trend: --'; trendEl.className = 'score-chart-stat trend-neutral'; }
  };

  const getScores = () => [..._scores];

  return { init, addScore, reset, getScores };
})();

// ── Auto-init on DOM ready ─────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ScoreChart.init);
} else {
  ScoreChart.init();
}

window.ScoreChart = ScoreChart;
