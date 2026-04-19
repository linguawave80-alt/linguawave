// public/js/main.js
// Landing Page JS - Animations, Wave Canvas, Scroll Effects
// Demonstrates: closures, event loop, DOM manipulation, Canvas API

'use strict';

// ─── Navbar scroll effect ─────────────────────────────────────────────────────
const initNavbar = () => {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  // Throttle scroll listener (event loop optimization)
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        navbar.classList.toggle('scrolled', window.scrollY > 20);
        ticking = false;
      });
      ticking = true;
    }
  });
};

// ─── Hero Wave Canvas Animation ───────────────────────────────────────────────
const initWaveCanvas = () => {
  const canvas = document.getElementById('waveCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Closure captures wave state
  let phase = 0;
  let animating = true;

  const colors = ['rgba(127,255,212,.8)', 'rgba(0,180,216,.6)', 'rgba(0,119,182,.4)'];

  const drawWave = () => {
    ctx.clearRect(0, 0, W, H);

    colors.forEach((color, i) => {
      const offset = (i * Math.PI * 2) / 3;
      const amplitude = 10 + i * 4;
      const frequency = 0.04 + i * 0.01;

      ctx.beginPath();
      ctx.moveTo(0, H / 2);

      for (let x = 0; x <= W; x++) {
        const y = H / 2 + amplitude * Math.sin(x * frequency + phase + offset)
          + (amplitude * 0.5) * Math.sin(x * frequency * 2 + phase * 1.5 + offset);
        ctx.lineTo(x, y);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2 - i * 0.4;
      ctx.stroke();
    });

    phase += 0.06;
    if (animating) requestAnimationFrame(drawWave);
  };

  drawWave();

  // Pause when off-screen (IntersectionObserver - event loop)
  const observer = new IntersectionObserver((entries) => {
    animating = entries[0].isIntersecting;
    if (animating) drawWave();
  });
  observer.observe(canvas);

  return () => { animating = false; observer.disconnect(); };
};

// ─── Intersection Observer for scroll animations ──────────────────────────────
const initScrollAnimations = () => {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('.feature-card, .step').forEach(el => {
    el.style.transition = 'opacity .6s ease, transform .6s ease';
    observer.observe(el);
  });
};

// ─── Hamburger Menu ───────────────────────────────────────────────────────────
const initHamburger = () => {
  const btn = document.getElementById('hamburger');
  const links = document.querySelector('.nav-links');
  const actions = document.querySelector('.nav-actions');

  btn?.addEventListener('click', () => {
    const open = btn.classList.toggle('open');
    if (links) links.style.display = open ? 'flex' : '';
    if (actions) actions.style.display = open ? 'flex' : '';
    // Animate hamburger lines
    const spans = btn.querySelectorAll('span');
    if (open) {
      spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      spans[1].style.opacity = '0';
      spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
    }
  });
};

// ─── Number counter animation ─────────────────────────────────────────────────
const animateCounters = () => {
  const counters = document.querySelectorAll('.stat-num');
  const parseNum = (str) => parseInt(str.replace(/[^0-9]/g, ''), 10);
  const formatNum = (n, original) => {
    const suffix = original.replace(/[0-9]/g, '');
    return n.toLocaleString() + suffix;
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseNum(el.textContent);
      const original = el.textContent;
      const duration = 1500;
      const start = performance.now();

      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = formatNum(Math.round(target * ease), original);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      observer.unobserve(el);
    });
  }, { threshold: 0.5 });

  counters.forEach(c => observer.observe(c));
};

// ─── Smooth anchor scrolling ──────────────────────────────────────────────────
const initSmoothScroll = () => {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
};

// ─── Demo button ─────────────────────────────────────────────────────────────
const initDemoBtn = () => {
  const handler = (e) => {
    const msg = 'Demo coming soon — sign up to try it live!';
    if (window.AuthModule && typeof AuthModule.showToast === 'function') {
      try { AuthModule.showToast(msg, 'info'); } catch (err) { console.warn('AuthModule.showToast failed', err); }
    } else {
      // graceful fallback when AuthModule isn't available — use inline toast
      try { showInlineToast(msg, 'info'); } catch (err) { console.warn('inline toast failed', err); }
    }
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
  };

  // Attach directly if element exists now
  const el = document.getElementById('watchDemo');
  if (el) {
    el.addEventListener('click', handler);
    return;
  }

  // Fallback: delegate at document level for dynamically-inserted buttons
  document.addEventListener('click', (e) => {
    const tgt = e.target;
    if (!tgt) return;
    if (tgt.id === 'watchDemo' || (tgt.closest && tgt.closest('#watchDemo'))) {
      handler(e);
    }
  });
};

// Small inline toast (non-blocking) used as a fallback when AuthModule isn't present.
const showInlineToast = (message, type = 'info', duration = 3500) => {
  try {
    let container = document.getElementById('inlineToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'inlineToastContainer';
      container.style.position = 'fixed';
      container.style.right = '20px';
      container.style.top = '20px';
      container.style.zIndex = '9999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `inline-toast inline-toast-${type}`;
    toast.style.minWidth = '220px';
    toast.style.maxWidth = '360px';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    toast.style.color = '#05202b';
    toast.style.background = type === 'error' ? '#ffd6d6' : (type === 'success' ? '#e6fffa' : '#f0f9ff');
    toast.style.border = '1px solid rgba(0,0,0,0.04)';
    toast.style.fontSize = '14px';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    toast.style.transition = 'opacity .25s ease, transform .25s ease';
    toast.textContent = message;

    container.appendChild(toast);
    // animate in
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-6px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
    return toast;
  } catch (err) {
    try { alert(message); } catch (e) { /* ignore */ }
  }
};

// ─── Redirect if already logged in ───────────────────────────────────────────
// const checkAuth = () => {
//   const token = localStorage.getItem('lw_token');
//   const user = localStorage.getItem('lw_user');
//   if (token && user) {
//     // Optionally auto-redirect, but let user stay on landing
//     // window.location.href = 'pages/dashboard.html';
//   }
// };

// ─── Init all ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  initNavbar();
  initWaveCanvas();
  initScrollAnimations();
  initHamburger();
  animateCounters();
  initSmoothScroll();
  initDemoBtn();
});
