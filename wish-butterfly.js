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
  const COSMETIC_ID = 'wish-butterfly-default';

  const CSS = `
  .wish-butterfly {
    position: absolute;
    width: 34px;
    height: 26px;
    cursor: pointer;
    z-index: 5;
    filter: drop-shadow(0 0 0 rgba(180,150,230,0));
    transition: filter 0.6s ease;
    animation: wishButterflyFloat 6.5s ease-in-out infinite;
  }
  .wish-butterfly.is-glowing { filter: drop-shadow(0 0 6px rgba(200,170,240,0.85)); }
  .wish-butterfly.is-open, .wish-butterfly.is-leaving { animation-play-state: paused; }
  .wish-butterfly.is-leaving {
    transition: transform 1.1s ease-in, opacity 1.1s ease-in;
    transform: translate(60px, -90px) scale(0.6);
    opacity: 0;
  }
  .wish-butterfly svg { width: 100%; height: 100%; display: block; }
  .wish-butterfly .wb-wing { transform-origin: 50% 50%; animation: wishButterflyWing 1.1s ease-in-out infinite; }
  .wish-butterfly .wb-wing-right { animation-delay: -0.55s; }
  .wish-butterfly.reduced-motion, .wish-butterfly.reduced-motion .wb-wing { animation: none; }

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
    background: #fbf7ef;
    border-radius: 14px 14px 14px 4px;
    box-shadow: 0 6px 18px rgba(90,70,120,0.18);
    font-family: inherit;
    font-size: 13px;
    color: #5b4b73;
    opacity: 0;
    transform: translateY(6px) scale(0.96);
    transition: opacity 0.28s ease, transform 0.28s ease;
    pointer-events: none;
  }
  .wish-bubble.is-visible { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  .wish-bubble textarea {
    width: 100%;
    resize: none;
    border: 1px solid #ded2ee;
    border-radius: 8px;
    padding: 6px 8px;
    font: inherit;
    color: inherit;
    background: #fffdf9;
    box-sizing: border-box;
    margin-top: 6px;
  }
  .wish-bubble .wb-label { font-size: 12px; opacity: 0.75; }
  .wish-bubble .wb-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .wish-bubble button { font: inherit; font-size: 12px; border: none; background: none; color: #8a76b0; cursor: pointer; padding: 4px 8px; }
  .wish-bubble button.wb-send { background: #c9b6ef; color: #3e2f57; border-radius: 8px; }
  .wish-bubble button.wb-send:disabled { opacity: 0.4; cursor: default; }
  `;

  function svgMarkup() {
    return (
      '<svg viewBox="0 0 34 26" xmlns="http://www.w3.org/2000/svg">' +
      '<g class="wb-wing wb-wing-left"><path d="M16 13 C6 2, -2 4, 3 14 C6 20, 13 18, 16 13 Z" fill="#c9b6ef" opacity="0.92"/></g>' +
      '<g class="wb-wing wb-wing-right"><path d="M18 13 C28 2, 36 4, 31 14 C28 20, 21 18, 18 13 Z" fill="#e3c9f0" opacity="0.92"/></g>' +
      '<ellipse cx="17" cy="13" rx="1.6" ry="6" fill="#7a6a97"/>' +
      '</svg>'
    );
  }

  function mount(container, options) {
    if (!container) return null;
    options = options || {};
    MiscCore.injectStyle(STYLE_ID, CSS);
    if (typeof MiscCosmetics !== 'undefined') {
      MiscCosmetics.register(COSMETIC_ID, { category: 'butterfly', label: 'Wish Butterfly' });
      if (!MiscCosmetics.isActive(COSMETIC_ID)) return null;
    }

    const reduced = MiscCore.prefersReducedMotion();
    const wrap = MiscCore.createEl('div', { className: 'wish-butterfly-mount' });
    wrap.style.position = 'relative';

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
    bubble.style.left = left;

    wrap.appendChild(butterfly);
    wrap.appendChild(bubble);
    container.appendChild(wrap);

    // Occasional idle glow, independent of hover/click.
    let glowTimer = null;
    function scheduleGlow() {
      if (reduced) return;
      glowTimer = setTimeout(function () {
        butterfly.classList.add('is-glowing');
        setTimeout(function () {
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

    function leave() {
      if (typeof MiscSound !== 'undefined') MiscSound.play('butterflyChime');
      butterfly.classList.add('is-glowing');
      closeBubble();
      if (glowTimer) clearTimeout(glowTimer);

      if (reduced) {
        setTimeout(function () { wrap.remove(); }, 700);
        return;
      }
      setTimeout(function () { butterfly.classList.add('is-leaving'); }, 500);
      butterfly.addEventListener('transitionend', function handler() {
        butterfly.removeEventListener('transitionend', handler);
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
