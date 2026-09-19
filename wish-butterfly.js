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

  function mount(container, options) {
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
      let trailTimer = setInterval(spawnTrailDot, 110);
      setTimeout(function () { butterfly.classList.add('is-leaving'); }, 500);
      butterfly.addEventListener('transitionend', function handler() {
        butterfly.removeEventListener('transitionend', handler);
        clearInterval(trailTimer);
        wrap.remove();
      });
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
