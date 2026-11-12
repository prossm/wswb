// Screen transitions: the current screen turns away like a book page, then the
// next one materializes piece by piece while a swoop of sparkles sweeps across.
// Uses the Web Animations API only. People who prefer reduced motion get an
// instant swap.

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let turning = false;
/** True while the old page is turning away, so callers can ignore repeat presses. */
export const isTurning = () => turning;

const TURN_MS = 460;
const MATERIALIZE_MS = 600;
const STAGGER_MS = 70;

/**
 * Swap `fromEl` out and `toEl` in.
 * dir  1 = forward (page turns to the left), -1 = back (page turns to the right)
 * onSwap  runs the moment `toEl` is shown (scroll, focus)
 * parts   returns the elements to materialize one by one (default: toEl's children)
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
  // If this page is still materializing from the last transition, snap that to the end.
  for (const a of fromEl.getAnimations({ subtree: true })) a.finish();
  try {
    // 1. Turn the page. It hinges on the edge it's turning toward, lifts,
    //    warps, and falls away.
    fromEl.style.transformOrigin = dir > 0 ? 'left center' : 'right center';
    const out = fromEl.animate(
      [
        {
          transform: 'perspective(1600px) rotateY(0deg) skewY(0deg) translateX(0) scale(1)',
          opacity: 1,
          filter: 'blur(0px) brightness(1)',
        },
        {
          transform: `perspective(1600px) rotateY(${30 * dir}deg) skewY(${-1.5 * dir}deg) translateX(${-4 * dir}%) scale(0.98)`,
          opacity: 0.9,
          filter: 'blur(0px) brightness(0.96)',
          offset: 0.45,
        },
        {
          transform: `perspective(1600px) rotateY(${85 * dir}deg) skewY(${-5 * dir}deg) translateX(${-16 * dir}%) scale(0.9)`,
          opacity: 0,
          filter: 'blur(5px) brightness(0.8)',
        },
      ],
      { duration: TURN_MS, easing: 'cubic-bezier(.55,.05,.7,.35)', fill: 'forwards' },
    );
    await out.finished;
    swap();
    out.cancel();
    fromEl.style.transformOrigin = '';
    turning = false; // the new page is usable now; materializing is just decoration

    // 2. Sparkles swoop across, and the new page materializes behind them.
    sparkleSwoop(toEl, dir);
    const items = (parts ? parts() : [...toEl.children]).filter((el) => !el.hidden && el.getClientRects().length);
    items.forEach((el, i) =>
      el.animate(
        [
          {
            opacity: 0,
            transform: `translateX(${36 * dir}px) translateY(10px) scale(0.97)`,
            filter: 'blur(10px) brightness(1.4)',
          },
          { opacity: 1, transform: 'translateX(0) translateY(0) scale(1)', filter: 'blur(1px) brightness(1.15)', offset: 0.6 },
          { opacity: 1, transform: 'none', filter: 'blur(0px) brightness(1)' },
        ],
        { duration: MATERIALIZE_MS, delay: 110 + i * STAGGER_MS, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' },
      ),
    );
  } catch {
    swap(); // never leave the user between screens
  } finally {
    turning = false;
  }
}

// ---------- Sparkles ----------

function sparkleSwoop(area, dir) {
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

  // A swooping trail that follows the page: right to left going forward,
  // left to right going back. It dips down and curls back up as it goes.
  const TRAIL = 28;
  for (let i = 0; i < TRAIL; i++) {
    const t = i / (TRAIL - 1);
    const along = dir > 0 ? 1.04 - 1.08 * t : -0.04 + 1.08 * t;
    const x = left + width * along + jitter(14);
    const y = top + height * (0.12 + 0.42 * t) - Math.sin(t * Math.PI * 1.6) * height * 0.12 + jitter(18);
    spawn(layer, x, y, t * 460, dir);
  }

  // Glitter settling over the new page as it appears.
  for (let i = 0; i < 18; i++) {
    spawn(layer, left + Math.random() * width, top + Math.random() * height * 0.85, 220 + Math.random() * 520, dir);
  }

  setTimeout(() => layer.remove(), 2200);
}

function spawn(layer, x, y, delay, dir) {
  const star = Math.random() < 0.6;
  const size = star ? 8 + Math.random() * 13 : 3 + Math.random() * 4;
  const s = document.createElement('span');
  s.className = `sparkle ${star ? 'star' : 'dot'} c${1 + Math.floor(Math.random() * 3)}`;
  s.style.width = `${size}px`;
  s.style.height = `${size}px`;
  layer.append(s);

  const x0 = x - size / 2;
  const y0 = y - size / 2;
  const dx = (-12 - Math.random() * 30) * dir; // drift along with the turn
  const dy = -8 - Math.random() * 28; // and float up a little
  const spin = (Math.random() - 0.5) * 220;

  s.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(0) rotate(0deg)`, opacity: 0 },
      {
        transform: `translate(${x0 + dx * 0.35}px, ${y0 + dy * 0.35}px) scale(1.15) rotate(${spin * 0.4}deg)`,
        opacity: 1,
        offset: 0.3,
      },
      {
        transform: `translate(${x0 + dx * 0.7}px, ${y0 + dy * 0.7}px) scale(0.8) rotate(${spin * 0.7}deg)`,
        opacity: 0.85,
        offset: 0.6,
      },
      { transform: `translate(${x0 + dx}px, ${y0 + dy}px) scale(0) rotate(${spin}deg)`, opacity: 0 },
    ],
    { duration: 750 + Math.random() * 550, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' },
  );
}

const jitter = (n) => (Math.random() - 0.5) * 2 * n;
