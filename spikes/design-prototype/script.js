// DNSpect — "The Instrument" spike: mode switching + run-complete reveal mock.
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  // ---------- Mode switcher ----------
  var modeTabs = $$('.mode-tab');
  var statusStrip = $('#status-strip');

  function setMode(mode) {
    modeTabs.forEach(function (t) {
      t.setAttribute('aria-selected', String(t.dataset.mode === mode));
      t.classList.toggle('is-active', t.dataset.mode === mode);
    });
    $('#quick').hidden = mode !== 'quick';
    $('#lab').hidden = mode !== 'lab';
  }

  modeTabs.forEach(function (t) {
    t.addEventListener('click', function () { setMode(t.dataset.mode); });
  });

  document.querySelectorAll('[data-goto]').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.goto); });
  });

  // ---------- Run-complete reveal mock ----------
  var checkBtn = $('#check-dns');
  var measuring = $('#measuring');
  var verdict = $('#verdict');
  var label = $('#status-label');
  var bar = $('#status-progress-bar');
  var eta = $('#status-eta');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  checkBtn.addEventListener('click', function () {
    checkBtn.disabled = true;
    verdict.classList.remove('run-complete');
    measuring.hidden = false;
    statusStrip.dataset.state = 'running';
    label.textContent = 'Measuring\u2026';
    eta.textContent = 'ETA 00:07';
    bar.style.width = '0%';

    var p = 0;
    var tick = setInterval(function () {
      p += 8;
      bar.style.width = Math.min(p, 100) + '%';
      if (p >= 100) {
        clearInterval(tick);
        measuring.hidden = true;
        statusStrip.dataset.state = 'complete';
        label.textContent = 'Complete';
        eta.textContent = 'Done \u2014 7.2s';
        if (reduceMotion) {
          verdict.classList.add('run-complete');
        } else {
          // One orchestrated reveal: let the browser apply the stagger.
          window.requestAnimationFrame(function () {
            verdict.classList.add('run-complete');
          });
        }
      }
    }, 180);
  });

  // ---------- Theme toggle (dark = default; light is a stripped re-token) ----------
  var themeBtn = $('#theme-toggle');
  themeBtn.addEventListener('click', function () {
    var html = document.documentElement;
    var light = html.dataset.theme === 'light';
    html.dataset.theme = light ? 'dark' : 'light';
  });

  // ---------- Lab sub-nav (visual only) ----------
  $$('.subnav-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.subnav-tab').forEach(function (o) {
        o.classList.toggle('is-active', o === t);
        o.setAttribute('aria-selected', String(o === t));
      });
    });
  });

  // ---------- Chips (visual only) ----------
  $$('.chip').forEach(function (c) {
    c.addEventListener('click', function () {
      var row = c.parentElement;
      $$('.chip', row).forEach(function (o) {
        o.classList.toggle('is-active', o === c);
      });
    });
  });
})();
