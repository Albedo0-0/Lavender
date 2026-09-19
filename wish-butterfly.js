/*
 * Lavender — Wish Butterfly.
 *
 * A small glowing decorative butterfly. Idle, it flutters gently and
 * occasionally glows. Clicking it opens a tiny inline wish-writing
 * moment (deliberately NOT the shared modal system — this should feel
 * like a small magical aside, not another dashboard/menu). Submitting
 * a wish makes the butterfly glow once, then it flies off and the
 * whole interaction disappears.
 *
 * By design, wishes are never persisted anywhere — the point is that
 * the wish is released, not tracked. This module does not read or
 * write State/localStorage at all, has no reward system, and has no
 * EXP/productivity effect.
 *
 * Usage:
 *   WishButterfly.mount(document.getElementById('some-scrapbook-area'));
 *   WishButterfly.mount(container, { top: '20%', left: '70%' });
 */
const WishButterfly = (function () {
  const STYLE_ID = 'misc-wish-butterfly-style';
  

  const CSS = `
  .wish-butterfly {
    position: absolute;
    width: 44px;
    height: 34px;
    pointer-events: auto;
    cursor: pointer;
    z-index: 5;
    filter: drop-shadow(0 0 0 rgba(138,148,104,0));
    transition: filter 0.6s ease;
    animation: wishButterflyFloat 6.5s ease-in-out infinite;
  }
  .wish-butterfly.is-glowing { filter: drop-shadow(0 0 6px rgba(138,148,104,0.85)); }
  .wish-butterfly.is-open { animation-play-state: paused; }
  .wish-butterfly.is-leaving {
    animation: none;
    transition: transform 7s cubic-bezier(0.25, 0.1, 0.35, 1), opacity 7s ease-in;
    transform: translate(-34vw, -10vh) scale(0.5) rotate(-10deg);
    opacity: 0;
  }
  .wish-butterfly svg { width: 100%; height: 100%; display: block; }
  .wish-butterfly .wb-wing { transform-origin: 50% 50%; animation: wishButterflyWing 1.1s ease-in-out infinite; }
  .wish-butterfly .wb-wing-right { animation-delay: -0.55s; }
  .wish-butterfly.reduced-motion, .wish-butterfly.reduced-motion .wb-wing { animation: none; }
  .wb-trail-dot {
    position: absolute;
    width: 8px; height: 8px;
    box-shadow: 0 0 8px rgba(168,176,135,0.9);
    border-radius: 50%;
    background: radial-gradient(circle, rgba(168,176,135,0.9), rgba(168,176,135,0));
    transform: translate(-50%, -50%);
    opacity: 0.9;
    transition: opacity 4.5s ease, transform 4.5s ease;
    pointer-events: none;
    z-index: 5;
  }
  .wb-trail-dot.is-fading { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }

  @keyframes wishButterflyFloat {
    0%, 100% { transform: translate(0, 0) rotate(0deg); }
    25% { transform: translate(3px, -6px) rotate(3deg); }
    50% { transform: translate(-2px, -2px) rotate(-2deg); }
    75% { transform: translate(4px, 3px) rotate(2deg); }
  }
  @keyframes wishButterflyWing {
    0%, 100% { transform: scaleX(1); }
    50% { transform: scaleX(0.55); }
  }

  .wish-bubble {
    position: absolute;
    z-index: 6;
    min-width: 190px;
    max-width: 230px;
    padding: 14px 14px 12px;
    background: var(--color-surface, #fffdf8);
    border: 1px solid var(--color-border, #ddd3bd);
    border-radius: 14px 14px 14px 4px;
    box-shadow: var(--shadow-md, 0 3px 10px rgba(63,47,33,0.12));
    font-family: var(--font-hand, inherit);
    font-size: 13px;
    color: var(--color-text, #3a3226);
    opacity: 0;
    transform: translateY(6px) scale(0.96);
    transition: opacity 0.28s ease, transform 0.28s ease;
    pointer-events: none;
  }
  .wish-bubble.is-visible { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  .wish-bubble textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--color-border, #ddd3bd);
    border-radius: 8px;
    padding: 6px 8px;
    font: inherit;
    color: inherit;
    background: var(--color-cream-050, #fffdf8);
    box-sizing: border-box;
    margin-top: 6px;
  }
  .wish-bubble .wb-label { font-size: 12px; opacity: 0.75; }
  .wish-bubble .wb-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .wish-bubble button { font: inherit; font-size: 12px; border: none; background: none; color: var(--color-text-muted, #6b6252); cursor: pointer; padding: 4px 8px; }
  .wish-bubble button.wb-send { background: var(--color-sage-500, #8a9468); color: var(--color-cream-050, #fffdf8); border-radius: 8px; }
  .wish-bubble button.wb-send:disabled { opacity: 0.4; cursor: default; }
  `;

  function svgMarkup() {
    return (
      '<svg viewBox="0 0 34 26" xmlns="http://www.w3.org/2000/svg">' +
      '<g class="wb-wing wb-wing-left"><path d="M16 13 C6 2, -2 4, 3 14 C6 20, 13 18, 16 13 Z" fill="var(--color-sage-400, #a8b087)" opacity="0.92"/></g>' +
      '<g class="wb-wing wb-wing-right"><path d="M18 13 C28 2, 36 4, 31 14 C28 20, 21 18, 18 13 Z" fill="var(--color-cream-300, #ece3cd)" opacity="0.92"/></g>' +
      '<ellipse cx="17" cy="13" rx="1.6" ry="6" fill="var(--color-brown-700, #5c4530)"/>' +
      '</svg>'
    );
  }

  const CSS_FLY = `
  .wish-butterfly.wb-fly { top: 0; left: 0; animation: none; will-change: transform; }
  .wish-butterfly.wb-fly.is-excited .wb-wing { animation-duration: 0.28s; }
  .wish-butterfly.wb-fly.is-glowing { filter: drop-shadow(0 0 10px rgba(200,210,160,0.95)) drop-shadow(0 0 24px rgba(168,176,135,0.7)); }
  .wb-dim { position: absolute; inset: 0; background: rgba(8,8,20,0.5); opacity: 0; transition: opacity 2.5s ease; pointer-events: none; }
  .wb-dim.is-on { opacity: 1; }
  .wb-dim.is-ending { transition: opacity 0.45s ease; }
  .wb-halo { position: absolute; top: 0; left: 0; width: 150px; height: 150px; margin: -75px 0 0 -75px; border-radius: 50%; background: radial-gradient(circle, rgba(200,210,160,0.55) 0%, rgba(168,176,135,0.22) 40%, rgba(168,176,135,0) 70%); opacity: 0; transition: opacity 1.8s ease; pointer-events: none; will-change: transform; }
  .wb-halo.is-on { opacity: 1; }
  .wb-trail-dot.is-long { transition-duration: 7s; }
  @media (prefers-reduced-motion: reduce) { .wb-dim, .wb-halo { transition: none; } }
  `;

  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    MiscCore.injectStyle(STYLE_ID + '-fly', CSS_FLY);
    const reduced = MiscCore.prefersReducedMotion();
    const LIFETIME_MS = options.lifetimeMs || 45000;

    const wrap = MiscCore.createEl('div', { className: 'wish-butterfly-mount' });
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    const dim = MiscCore.createEl('div', { className: 'wb-dim' });
    wrap.appendChild(dim);
    container.appendChild(wrap);

    let spawnTimer = null;
    let reducedTimer = null;
    let rafId = null;
    let live = null;

    function scheduleSpawn(ms) {
      if (spawnTimer) clearTimeout(spawnTimer);
      spawnTimer = setTimeout(spawn, ms);
    }

    function dot(x, y, long) {
      const d = MiscCore.createEl('div', { className: 'wb-trail-dot' + (long ? ' is-long' : '') });
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      wrap.appendChild(d);
      requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add('is-fading'); }); });
      setTimeout(function () { d.remove(); }, long ? 7200 : 4700);
    }

    function spawn() {
      if (live) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const butterfly = MiscCore.createEl('div', {
        className: 'wish-butterfly wb-fly is-glowing' + (reduced ? ' reduced-motion' : ''),
        html: svgMarkup(),
        attrs: { role: 'button', tabindex: '0', 'aria-label': 'Make a wish' }
      });
      const halo = MiscCore.createEl('div', { className: 'wb-halo' });
      const bubble = MiscCore.createEl('div', { className: 'wish-bubble' });
      bubble.innerHTML =
        '<div class="wb-label">Make a little wish&hellip;</div>' +
        '<textarea rows="2" maxlength="140" placeholder="whisper it here"></textarea>' +
        '<div class="wb-actions">' +
        '<button type="button" class="wb-cancel">not now</button>' +
        '<button type="button" class="wb-send" disabled>let it go</button>' +
        '</div>';
      wrap.appendChild(halo);
      wrap.appendChild(butterfly);
      wrap.appendChild(bubble);
      const textarea = bubble.querySelector('textarea');
      const sendBtn = bubble.querySelector('.wb-send');
      const cancelBtn = bubble.querySelector('.wb-cancel');

      let x, y, th;
      const side = MiscCore.randInt(0, 3);
      if (reduced) { x = vw * 0.86; y = vh * 0.16; th = -Math.PI / 2; }
      else if (side === 0) { x = -40; y = MiscCore.rand(vh * 0.2, vh * 0.8); th = 0; }
      else if (side === 1) { x = vw + 40; y = MiscCore.rand(vh * 0.2, vh * 0.8); th = Math.PI; }
      else if (side === 2) { x = MiscCore.rand(vw * 0.2, vw * 0.8); y = -40; th = Math.PI / 2; }
      else { x = MiscCore.rand(vw * 0.2, vw * 0.8); y = vh + 40; th = -Math.PI / 2; }

      const s = {
        x: x, y: y, th: th,
        phase: reduced ? 'wander' : 'enter',
        t: 0, bias: 0, biasT: 0, trailAcc: 0,
        open: false, hover: false,
        last: performance.now(),
        deadline: performance.now() + LIFETIME_MS,
        target: { x: MiscCore.rand(vw * 0.25, vw * 0.75), y: MiscCore.rand(vh * 0.25, vh * 0.7) },
        exitPt: null
      };
      const me = { s: s };
      live = me;

      function place() {
        butterfly.style.transform = 'translate(' + (s.x - 22) + 'px,' + (s.y - 17) + 'px) rotate(' + (s.th * 180 / Math.PI + 90) + 'deg)';
        halo.style.transform = 'translate(' + s.x + 'px,' + s.y + 'px)';
      }

      function steer(desired, rate, dt) {
        const d = angDiff(desired, s.th);
        s.th += Math.max(-rate * dt, Math.min(rate * dt, d));
      }

      function pickExit() {
        const w = window.innerWidth, h = window.innerHeight;
        const d = [s.x, w - s.x, s.y, h - s.y];
        const m = Math.min.apply(null, d);
        const j = MiscCore.rand(-100, 100);
        if (m === d[0]) return { x: -140, y: s.y + j };
        if (m === d[1]) return { x: w + 140, y: s.y + j };
        if (m === d[2]) return { x: s.x + j, y: -140 };
        return { x: s.x + j, y: h + 140 };
      }

      function end() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (reducedTimer) clearTimeout(reducedTimer);
        butterfly.remove();
        halo.remove();
        bubble.remove();
        // Fade the dim overlay out quickly here instead of over its normal
        // 2.5s entrance duration — otherwise the butterfly/halo vanish
        // instantly (off-screen) while the dark overlay lingers alone for
        // roughly a second, reading as the screen "going blank".
        dim.classList.add('is-ending');
        dim.classList.remove('is-on');
        setTimeout(function () { dim.classList.remove('is-ending'); }, 460);
        if (live === me) live = null;
        scheduleSpawn(MiscCore.rand(15, 25) * 60000);
      }

      function fadeEnd() {
        butterfly.style.transition = 'opacity 0.7s ease';
        butterfly.style.opacity = '0';
        halo.classList.remove('is-on');
        setTimeout(end, 750);
      }

      function frame(now) {
        if (live !== me) return;
        const dt = Math.min(0.05, (now - s.last) / 1000);
        s.last = now;
        const vw = window.innerWidth, vh = window.innerHeight;
        let speed = 60, trailEvery = 0.2, long = false;
        const offEdge = s.x < 90 || s.x > vw - 90 || s.y < 90 || s.y > vh - 90;
        const toCenter = Math.atan2(vh / 2 - s.y, vw / 2 - s.x);
        if (s.open) s.deadline += dt * 1000;

        if (s.phase === 'enter') {
          steer(Math.atan2(s.target.y - s.y, s.target.x - s.x), 2.2, dt);
          speed = 95;
          if (s.x > 40 && s.x < vw - 40 && s.y > 40 && s.y < vh - 40) s.phase = 'wander';
        } else if (s.phase === 'wander') {
          s.biasT -= dt;
          if (s.biasT <= 0) { s.bias = MiscCore.rand(-1.2, 1.2); s.biasT = MiscCore.rand(0.8, 2); }
          steer(offEdge ? toCenter : s.th + s.bias, 1.8, dt);
          speed = 55 + Math.sin(now / 700) * 18;
          if (s.hover) speed *= 0.3;
          if (s.open) speed = 0;
          if (!s.open && now >= s.deadline) { s.phase = 'exit'; s.exitPt = pickExit(); }
        } else if (s.phase === 'exit') {
          steer(Math.atan2(s.exitPt.y - s.y, s.exitPt.x - s.x), 2.4, dt);
          speed = 140; trailEvery = 0.08; long = true;
        } else if (s.phase === 'excited') {
          s.t += dt; s.biasT -= dt;
          if (s.biasT <= 0) { s.bias = MiscCore.rand(-1.9, 1.9); s.biasT = 0.22; }
          steer(offEdge ? toCenter : s.th + s.bias, 7, dt);
          speed = 420; trailEvery = 0.03; long = true;
          if (s.t > 1.6) { s.phase = 'leave'; s.exitPt = pickExit(); }
        } else if (s.phase === 'leave') {
          steer(Math.atan2(s.exitPt.y - s.y, s.exitPt.x - s.x), 5, dt);
          speed = 560; trailEvery = 0.03; long = true;
        }

        s.x += Math.cos(s.th) * speed * dt;
        s.y += Math.sin(s.th) * speed * dt;
        place();

        s.trailAcc += dt;
        if (!s.open && s.trailAcc >= trailEvery) { s.trailAcc = 0; dot(s.x, s.y, long); }

        if ((s.phase === 'exit' || s.phase === 'leave') && (s.x < -60 || s.x > vw + 60 || s.y < -60 || s.y > vh + 60)) {
          end();
          return;
        }
        rafId = requestAnimationFrame(frame);
      }

      function openBubble() {
        if (s.open || s.phase === 'excited' || s.phase === 'leave' || s.phase === 'exit') return;
        s.open = true;
        butterfly.classList.add('is-open');
        bubble.style.left = MiscCore.clamp(s.x - 100, 8, window.innerWidth - 240) + 'px';
        bubble.style.top = MiscCore.clamp(s.y + 30, 8, window.innerHeight - 170) + 'px';
        bubble.classList.add('is-visible');
        textarea.value = '';
        sendBtn.disabled = true;
        textarea.focus();
      }

      function closeBubble() {
        s.open = false;
        butterfly.classList.remove('is-open');
        bubble.classList.remove('is-visible');
      }

      butterfly.addEventListener('click', openBubble);
      butterfly.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBubble(); }
      });
      butterfly.addEventListener('mouseenter', function () { s.hover = true; });
      butterfly.addEventListener('mouseleave', function () { s.hover = false; });
      textarea.addEventListener('input', function () { sendBtn.disabled = textarea.value.trim().length === 0; });
      cancelBtn.addEventListener('click', function () {
        textarea.value = '';
        closeBubble();
        if (reduced) { fadeEnd(); return; }
        butterfly.classList.add('is-excited');
        s.phase = 'excited';
        s.t = 0;
        s.biasT = 0;
      });
      sendBtn.addEventListener('click', function () {
        if (textarea.value.trim().length === 0) return;
        // The wish text is intentionally discarded — see file header.
        textarea.value = '';
        closeBubble();
        if (typeof MiscSound !== 'undefined') MiscSound.play('butterflyChime');
        if (reduced) { fadeEnd(); return; }
        butterfly.classList.add('is-excited');
        s.phase = 'excited';
        s.t = 0;
        s.biasT = 0;
      });

      place();
      if (reduced) {
        dim.classList.add('is-on');
        halo.classList.add('is-on');
        reducedTimer = setTimeout(function tryEnd() {
          if (live !== me) return;
          if (s.open) { reducedTimer = setTimeout(tryEnd, 5000); return; }
          fadeEnd();
        }, LIFETIME_MS);
      } else {
        requestAnimationFrame(function () { dim.classList.add('is-on'); halo.classList.add('is-on'); });
        rafId = requestAnimationFrame(frame);
      }
    }

    scheduleSpawn(options.firstDelayMs || 6000);

    return {
      element: wrap,
      destroy: function () {
        if (spawnTimer) clearTimeout(spawnTimer);
        if (reducedTimer) clearTimeout(reducedTimer);
        if (rafId) cancelAnimationFrame(rafId);
        live = null;
        wrap.remove();
      }
    };
  }

  function mountLegacy(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    

    const reduced = MiscCore.prefersReducedMotion();
    const wrap = MiscCore.createEl('div', { className: 'wish-butterfly-mount' });
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

    const top = options.top || '10%';
    const left = options.left || '80%';

    const butterfly = MiscCore.createEl('div', {
      className: 'wish-butterfly' + (reduced ? ' reduced-motion' : ''),
      html: svgMarkup(),
      attrs: { role: 'button', tabindex: '0', 'aria-label': 'Make a wish' }
    });
    butterfly.style.top = top;
    butterfly.style.left = left;

    const bubble = MiscCore.createEl('div', { className: 'wish-bubble' });
    bubble.innerHTML =
      '<div class="wb-label">Make a little wish&hellip;</div>' +
      '<textarea rows="2" maxlength="140" placeholder="whisper it here"></textarea>' +
      '<div class="wb-actions">' +
      '<button type="button" class="wb-cancel">not now</button>' +
      '<button type="button" class="wb-send" disabled>let it go</button>' +
      '</div>';
    bubble.style.top = 'calc(' + top + ' + 34px)';
    bubble.style.left = 'min(' + left + ', calc(100% - 250px))';

    wrap.appendChild(butterfly);
    wrap.appendChild(bubble);
    container.appendChild(wrap);

    // Occasional idle glow, independent of hover/click.
    let glowTimer = null;
    function scheduleGlow() {
      if (reduced || !wrap.isConnected) return;
      glowTimer = setTimeout(function () {
        butterfly.classList.add('is-glowing');
        setTimeout(function () {
          if (butterfly.dataset.leaving) return;
          butterfly.classList.remove('is-glowing');
          scheduleGlow();
        }, 1200);
      }, MiscCore.rand(4000, 9000));
    }
    scheduleGlow();

    const textarea = bubble.querySelector('textarea');
    const sendBtn = bubble.querySelector('.wb-send');
    const cancelBtn = bubble.querySelector('.wb-cancel');

    function openBubble() {
      if (butterfly.classList.contains('is-open') || butterfly.classList.contains('is-leaving')) return;
      butterfly.classList.add('is-open');
      bubble.classList.add('is-visible');
      textarea.value = '';
      sendBtn.disabled = true;
      textarea.focus();
    }

    function closeBubble() {
      butterfly.classList.remove('is-open');
      bubble.classList.remove('is-visible');
    }

    function spawnTrailDot() {
      const r = butterfly.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const dot = MiscCore.createEl('div', { className: 'wb-trail-dot' });
      dot.style.left = (r.left - wr.left + r.width / 2) + 'px';
      dot.style.top = (r.top - wr.top + r.height / 2) + 'px';
      wrap.appendChild(dot);
      requestAnimationFrame(function () { dot.classList.add('is-fading'); });
      setTimeout(function () { dot.remove(); }, 4700);
    }

    function leave() {
      if (typeof MiscSound !== 'undefined') MiscSound.play('butterflyChime');
      butterfly.dataset.leaving = '1';
      butterfly.classList.add('is-glowing');
      closeBubble();
      if (glowTimer) clearTimeout(glowTimer);

      if (reduced) {
        setTimeout(function () { wrap.remove(); }, 700);
        return;
      }
      const trailTimer = setInterval(spawnTrailDot, 110);
      setTimeout(function () { butterfly.classList.add('is-leaving'); }, 500);
      setTimeout(function () { clearInterval(trailTimer); }, 7500);
      setTimeout(function () { wrap.remove(); }, 12500);
    }

    butterfly.addEventListener('click', openBubble);
    butterfly.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBubble(); }
    });
    textarea.addEventListener('input', function () {
      sendBtn.disabled = textarea.value.trim().length === 0;
    });
    cancelBtn.addEventListener('click', closeBubble);
    sendBtn.addEventListener('click', function () {
      if (textarea.value.trim().length === 0) return;
      // The wish text is intentionally discarded here — see file header.
      leave();
    });

    return {
      element: wrap,
      destroy: function () {
        if (glowTimer) clearTimeout(glowTimer);
        wrap.remove();
      }
    };
  }

  return { mount: mount };
})();
