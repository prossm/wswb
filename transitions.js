// Screen transitions: the current screen tilts away and fades like a page
// turning, then the next one fades in piece by piece while a few faint specks
// drift across. Uses the Web Animations API only. People who prefer reduced
// motion get an instant swap.

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let turning = false;
/** True while the old page is fading out, so callers can ignore repeat presses. */
export const isTurning = () => turning;

const OUT_MS = 280;
const IN_MS = 480;
const STAGGER_MS = 45;
const EASE_OUT = 'cubic-bezier(.4,0,1,1)'; // gentle start, leaves quickly
const EASE_IN = 'cubic-bezier(.22,1,.36,1)'; // arrives quickly, settles softly

/**
 * Swap `fromEl` out and `toEl` in.
 * dir  1 = forward (page turns to the left), -1 = back (page turns to the right)
 * onSwap  runs the moment `toEl` is shown (scroll, focus)
 * parts   returns the elements to fade in one by one (default: toEl's children)
 */
export async function turnPage(fromEl, toEl, { dir = 1, onSwap, parts } = {}) {
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    fromEl.hidden = true;
    toEl.hidden = false;
    onSwap?.();
  };

  if (reducedMotion() || typeof fromEl.animate !== 'function') {
    swap();
    return;
  }

  turning = true;
  // If this page is still fading in from the last transition, snap that to the end.
  for (const a of fromEl.getAnimations({ subtree: true })) a.finish();
  try {
    // 1. A slight page-turn tilt toward the spine, drifting and fading out.
    fromEl.style.transformOrigin = dir > 0 ? 'left center' : 'right center';
    const out = fromEl.animate(
      [
        { transform: 'perspective(1800px) rotateY(0deg) translateX(0)', opacity: 1, filter: 'blur(0px)' },
        { transform: `perspective(1800px) rotateY(${14 * dir}deg) translateX(${-24 * dir}px)`, opacity: 0, filter: 'blur(2px)' },
      ],
      { duration: OUT_MS, easing: EASE_OUT, fill: 'forwards' },
    );
    await out.finished;
    swap();
    out.cancel();
    fromEl.style.transformOrigin = '';
    turning = false; // the new page is usable now; fading in is just decoration

    // 2. The new page fades in from the turning side, one piece after another.
    sparkleTrail(toEl, dir);
    const items = (parts ? parts() : [...toEl.children]).filter((el) => !el.hidden && el.getClientRects().length);
    items.forEach((el, i) =>
      el.animate(
        [
          { opacity: 0, transform: `translateX(${14 * dir}px)`, filter: 'blur(3px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0px)' },
        ],
        { duration: IN_MS, delay: 40 + i * STAGGER_MS, easing: EASE_IN, fill: 'backwards' },
      ),
    );
  } catch {
    swap(); // never leave the user between screens
  } finally {
    turning = false;
  }
}

// ---------- A brief, faint trail of specks ----------

function sparkleTrail(area, dir) {
  const r = area.getBoundingClientRect();
  const left = Math.max(r.left, 0);
  const width = Math.min(r.right, window.innerWidth) - left;
  const top = Math.max(r.top, 0);
  const height = Math.min(Math.max(r.bottom, top + 200), window.innerHeight) - top;
  if (width <= 0 || height <= 0) return;

  const layer = document.createElement('div');
  layer.className = 'sparkles';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);

  // A loose arc near the top of the new page, in the direction of the turn.
  const COUNT = 12;
  for (let i = 0; i < COUNT; i++) {
    const t = i / (COUNT - 1);
    const along = dir > 0 ? 0.95 - 0.9 * t : 0.05 + 0.9 * t;
    const x = left + width * along + jitter(10);
    const y = top + Math.min(height, 520) * (0.12 + 0.18 * t) - Math.sin(t * Math.PI) * 24 + jitter(12);
    spawn(layer, x, y, t * 260, dir);
  }

  setTimeout(() => layer.remove(), 1200);
}

function spawn(layer, x, y, delay, dir) {
  const star = Math.random() < 0.3;
  const size = star ? 5 + Math.random() * 3 : 2 + Math.random() * 2;
  const s = document.createElement('span');
  s.className = `sparkle ${star ? 'star' : 'dot'} c${1 + Math.floor(Math.random() * 3)}`;
  s.style.width = `${size}px`;
  s.style.height = `${size}px`;
  layer.append(s);

  const x0 = x - size / 2;
  const y0 = y - size / 2;
  const dx = (-6 - Math.random() * 10) * dir;
  const dy = -4 - Math.random() * 8;

  s.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${x0 + dx * 0.4}px, ${y0 + dy * 0.4}px) scale(1)`, opacity: 0.7, offset: 0.35 },
      { transform: `translate(${x0 + dx}px, ${y0 + dy}px) scale(0.6)`, opacity: 0 },
    ],
    { duration: 420 + Math.random() * 220, delay, easing: 'ease-out', fill: 'both' },
  );
}

const jitter = (n) => (Math.random() - 0.5) * 2 * n;
