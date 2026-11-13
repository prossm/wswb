// UI and step navigation. All data access goes through data.js.

import { submitIdea, listIdeas, toggleReaction, isDemo, newId, storage } from './data.js';
import { turnPage, isTurning } from './transitions.js';

const SITE_URL = 'https://wswb.fyi';
const DRAFT_KEY = 'wswb.draft';
const SUBMITTED_KEY = 'wswb.submitted';
const TRUNCATE_AT = 280;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// GitHub usernames: letters, digits, single hyphens, no leading/trailing hyphen, max 39.
const GITHUB_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

// Accept "@name" or a pasted profile URL and keep just the username.
function cleanGithub(v) {
  return v
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
}

const FIELDS = {
  idea: { max: 1000, required: true, message: "Write a few words about what you'd build." },
  who: { max: 200, required: true, message: 'Add who this would be for.' },
  pain: { max: 1000, required: true, message: 'Describe the problem they have.' },
  why_tech: { max: 600 },
  smallest: { max: 600 },
  name: { max: 80 },
  github: {
    // maxlength is generous so people can paste a profile URL; it's cleaned up on check/submit.
    max: 100,
    message: "That doesn't look like a GitHub username. Fix it or leave it blank.",
    check: (v) => v === '' || GITHUB_RE.test(cleanGithub(v)),
  },
  email: {
    max: 254,
    message: "That email doesn't look right. Fix it or leave it blank.",
    check: (v) => v === '' || EMAIL_RE.test(v),
  },
};
const TEXT_KEYS = Object.keys(FIELDS);
const STEP_FIELDS = { 1: ['idea'], 2: ['who', 'pain', 'why_tech', 'smallest'], 3: ['name', 'github', 'email'] };

const EVIDENCE_LABELS = {
  one_of_them: "They're one of them",
  talked_to_them: "They've talked to them",
  hunch: "It's a hunch",
};
const ROLE_LABELS = {
  code: 'Code',
  design: 'Design',
  users: 'Talking to users',
  testing: 'Testing',
  organizing: 'Organizing',
};
const REACTIONS = {
  work_on: { label: "I'd work on this", flag: 'i_work_on', count: 'work_on_count' },
  know_someone: { label: 'I know someone with this problem', flag: 'i_know_someone', count: 'know_someone_count' },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const form = $('#idea-form');
const board = $('#board');

let view = null; // 'form' | 'board'
let step = 1;
let furthest = 1; // furthest step reached for this idea, so the top Next can return there
let pendingId = null; // id for the idea being submitted; reused on retry
let submitting = false;

// ============================================================
// Form: values, draft, validation
// ============================================================

function collect() {
  const v = {};
  for (const k of TEXT_KEYS) v[k] = form.elements[k].value;
  v.evidence = $('input[name="evidence"]:checked', form)?.value ?? '';
  v.help_roles = $$('input[name="help_roles"]:checked', form).map((i) => i.value);
  return v;
}

function restore(v = {}) {
  for (const k of TEXT_KEYS) {
    form.elements[k].value = typeof v[k] === 'string' ? v[k].slice(0, FIELDS[k].max) : '';
    updateCounter(k);
    setError(k, false);
  }
  for (const r of $$('input[name="evidence"]', form)) r.checked = r.value === v.evidence;
  const roles = Array.isArray(v.help_roles) ? v.help_roles : [];
  for (const c of $$('input[name="help_roles"]', form)) c.checked = roles.includes(c.value);
  form.elements.website.value = '';
}

function hasContent(v) {
  return TEXT_KEYS.some((k) => v[k].trim() !== '') || v.evidence !== '' || v.help_roles.length > 0;
}

function saveDraft() {
  const values = collect();
  if (!hasContent(values)) {
    storage.remove(DRAFT_KEY);
    return;
  }
  storage.set(DRAFT_KEY, JSON.stringify({ values, step, id: pendingId }));
}

function loadDraft() {
  try {
    const d = JSON.parse(storage.get(DRAFT_KEY) || 'null');
    return d && typeof d === 'object' && d.values ? d : null;
  } catch {
    return null;
  }
}

function isValid(name) {
  const f = FIELDS[name];
  const v = form.elements[name].value.trim();
  if (f.required && v.length < 3) return false;
  if (f.check && !f.check(v)) return false;
  return true;
}

function setError(name, show) {
  const errEl = $(`#${name}-error`);
  if (!errEl) return;
  const input = form.elements[name];
  errEl.textContent = show ? FIELDS[name].message : '';
  errEl.hidden = !show;
  if (show) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function validateStep(n) {
  const bad = STEP_FIELDS[n].filter((k) => !isValid(k));
  for (const k of STEP_FIELDS[n]) setError(k, bad.includes(k));
  if (bad.length) form.elements[bad[0]].focus();
  return bad.length === 0;
}

function updateCounter(name) {
  const counter = $(`#${name}-counter`);
  if (!counter) return;
  const { max } = FIELDS[name];
  const len = form.elements[name].value.length;
  const show = len > max * 0.8;
  counter.hidden = !show;
  counter.textContent = show ? `${len} / ${max}` : '';
  counter.classList.toggle('at-limit', len >= max);
}

// ============================================================
// Form: steps and submit
// ============================================================

function focusFirstField() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  $(`.step[data-step="${step}"]`, form).querySelector('input, textarea')?.focus({ preventScroll: true });
}

function showStep(n, { focus = true, animate = false } = {}) {
  const from = $('.step:not([hidden])', form);
  const to = $(`.step[data-step="${n}"]`, form);
  const dir = n >= step ? 1 : -1;
  step = n;
  furthest = Math.max(furthest, n);
  $('#step-num').textContent = String(n);
  $$('.progress-seg', form).forEach((seg, i) => seg.classList.toggle('filled', i < n));
  saveDraft();
  const arrive = () => {
    updateStepNav(); // when the new page appears, not before the old one turns
    if (focus) focusFirstField();
  };
  if (animate && from && from !== to) return turnPage(from, to, { dir, onSwap: arrive });
  for (const s of $$('.step', form)) s.hidden = s !== to;
  arrive();
}

// Top-of-page navigation: "Previous" on steps 2 and 3, and "Next" when you've
// stepped back from a later step.
function updateStepNav() {
  $('#nav-prev').hidden = step === 1;
  $('#nav-next').hidden = !(step < furthest && step < 3);
}

function goPrev() {
  if (isTurning() || step === 1) return;
  showStep(step - 1, { animate: true });
}

function goNext() {
  if (isTurning() || step === 3) return;
  if (validateStep(step)) showStep(step + 1, { animate: true });
}

function showForm({ fromDraft = true, animate = false } = {}) {
  const draft = fromDraft ? loadDraft() : null;
  restore(draft?.values);
  pendingId = draft?.id ?? null;
  hideSubmitError();
  setSubmitting(false);
  // Only resume later steps if step 1 is actually answered.
  const resume = draft && isValid('idea') ? Math.min(Math.max(Number(draft.step) || 1, 1), 3) : 1;
  furthest = resume;
  showStep(resume, { focus: false });
  if (animate && view === 'board') {
    view = 'form';
    turnPage(board, form, { dir: 1, onSwap: focusFirstField });
  } else {
    showView('form');
    focusFirstField();
  }
}

function setSubmitting(on) {
  submitting = on;
  const btn = $('#submit-btn');
  btn.disabled = on;
  btn.textContent = on ? 'Sharing...' : 'Share my idea';
  $('#submit-retry').disabled = on;
}

function showSubmitError() {
  $('#submit-error').hidden = false;
}
function hideSubmitError() {
  $('#submit-error').hidden = true;
}

const optional = (s) => (s.trim() === '' ? null : s.trim());

async function submit() {
  if (submitting) return;
  if (!validateStep(3)) return;

  // Honeypot filled: pretend it worked, write nothing.
  if (form.elements.website.value !== '') {
    finishSubmit(null);
    return;
  }

  const v = collect();
  pendingId ??= newId();
  saveDraft(); // remember the id so a retry after refresh can't double-post

  const row = {
    id: pendingId,
    idea: v.idea.trim(),
    who: v.who.trim(),
    pain: v.pain.trim(),
    why_tech: optional(v.why_tech),
    evidence: v.evidence || null,
    smallest: optional(v.smallest),
    help_roles: v.help_roles,
    name: optional(v.name),
    github: optional(cleanGithub(v.github)),
    email: optional(v.email),
  };

  setSubmitting(true);
  hideSubmitError();
  try {
    await submitIdea(row);
  } catch (err) {
    console.error('Submit failed', err);
    setSubmitting(false);
    showSubmitError();
    return;
  }
  setSubmitting(false);
  finishSubmit(row.id);
}

function finishSubmit(id) {
  storage.remove(DRAFT_KEY);
  storage.set(SUBMITTED_KEY, '1');
  pendingId = null;
  restore({});
  $('#sort').value = 'newest';
  showBoard({ highlight: id, animate: true });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (isTurning()) return;
  if (step < 3) goNext();
  else submit();
});

// Keyboard shortcuts (Ctrl instead of Cmd on Windows/Linux):
//   Cmd-Enter  the step's main button: Next, or "Share my idea" on step 3
//   Cmd-[      previous step
//   Cmd-]      next step, if this step's required fields are filled in
document.addEventListener('keydown', (e) => {
  if (view !== 'form' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.isComposing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    form.requestSubmit();
  } else if (e.code === 'BracketLeft' || e.key === '[') {
    e.preventDefault(); // otherwise the browser goes Back and leaves the page
    goPrev();
  } else if (e.code === 'BracketRight' || e.key === ']') {
    e.preventDefault();
    goNext();
  }
});

for (const b of $$('[data-back]', form)) b.addEventListener('click', goPrev);
$('#nav-prev').addEventListener('click', goPrev);
$('#nav-next').addEventListener('click', goNext);

// Show the right modifier key in the button tooltips.
{
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
  $('#nav-prev').title = `Previous question (${mod}[)`;
  $('#nav-next').title = `Next question (${mod}])`;
}

$('#submit-retry').addEventListener('click', submit);

form.addEventListener('input', (e) => {
  const name = e.target.name;
  if (FIELDS[name]) {
    updateCounter(name);
    // Clear an error as soon as the field is fixed.
    if (e.target.getAttribute('aria-invalid') === 'true' && isValid(name)) setError(name, false);
  }
  saveDraft();
});

form.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'help_roles' && t.checked) {
    // "Just sharing the idea" is exclusive with the other roles.
    for (const c of $$('input[name="help_roles"]', form)) {
      if (c === t) continue;
      if (t.value === 'idea_only' || c.value === 'idea_only') c.checked = false;
    }
  }
  saveDraft();
});

// ============================================================
// Board
// ============================================================

let ideas = [];
let loading = false;
let lastLoad = 0;
const expanded = new Set(); // idea ids with "Show more" open
const pending = new Set(); // `${id}:${kind}` reactions waiting on the server

function showView(name) {
  view = name;
  form.hidden = name !== 'form';
  board.hidden = name !== 'board';
}

function showBoard({ highlight = null, animate = false } = {}) {
  const arrive = () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#board-title').focus({ preventScroll: true });
  };
  if (animate && view === 'form') {
    view = 'board';
    turnPage(form, board, {
      dir: 1,
      exit: 'push',
      onSwap: arrive,
      // Header pieces, then the first few cards, appear one after another.
      parts: () => [...$('.board-header').children, $('#board-status'), $('#board-error'), $('#empty-state'), ...$$('#cards > li').slice(0, 6)],
    });
  } else {
    showView('board');
    arrive();
  }
  loadBoard({ highlight });
}

async function loadBoard({ highlight = null } = {}) {
  if (loading) return;
  loading = true;
  lastLoad = Date.now();
  const status = $('#board-status');
  if (!ideas.length) status.textContent = 'Loading ideas...';
  try {
    ideas = await listIdeas();
    $('#board-error').hidden = true;
    status.textContent = '';
    renderBoard();
    if (highlight) flashCard(highlight);
  } catch (err) {
    console.error('Loading the board failed', err);
    status.textContent = '';
    $('#board-error').hidden = false;
  } finally {
    loading = false;
  }
}

const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
const SORTS = {
  newest: byNewest,
  work_on: (a, b) => b.work_on_count - a.work_on_count || byNewest(a, b),
  know_someone: (a, b) => b.know_someone_count - a.know_someone_count || byNewest(a, b),
};

function renderBoard() {
  const focusKey = document.activeElement?.dataset?.focusKey;

  const n = ideas.length;
  $('#board-count').textContent = `${n} ${n === 1 ? 'idea' : 'ideas'}`;
  $('#empty-state').hidden = !ideas.every((i) => i.is_mine);

  const sorted = [...ideas].sort(SORTS[$('#sort').value] ?? byNewest);
  $('#cards').replaceChildren(...sorted.map(renderCard));

  if (focusKey) $(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function renderCard(idea) {
  const titleId = `t-${idea.id}`;
  const isLong = idea.idea.length > TRUNCATE_AT;
  const open = expanded.has(idea.id);

  const badges = [];
  if (idea.is_mine) badges.push(el('span', { class: 'badge yours', text: 'Yours' }));
  if (idea.example) badges.push(el('span', { class: 'badge', text: 'Example' }));

  const headline = el('h2', { class: 'headline', id: titleId, text: isLong && !open ? truncate(idea.idea) : idea.idea });

  const more = isLong
    ? el('button', {
        type: 'button',
        class: 'link-btn',
        'aria-expanded': String(open),
        'data-focus-key': `${idea.id}:more`,
        text: open ? 'Show less' : 'Show more',
        onclick: () => {
          if (expanded.has(idea.id)) expanded.delete(idea.id);
          else expanded.add(idea.id);
          renderBoard();
        },
      })
    : null;

  // Every answer reads the same way: a short label, then the text.
  const roles = (idea.help_roles || []).filter((r) => ROLE_LABELS[r]).map((r) => ROLE_LABELS[r]);
  const rows = [
    ['For', idea.who],
    ['Problem', idea.pain],
    ['Why software', idea.why_tech],
    ['Smallest version', idea.smallest],
    ['How they know', EVIDENCE_LABELS[idea.evidence]],
    ['Can help with', roles.join(', ')],
  ].filter(([, v]) => v && v.trim());
  const details = rows.length
    ? el('dl', { class: 'details' }, rows.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))))
    : null;

  // Who and when, at the top next to any badge.
  const top = el(
    'div',
    { class: 'card-top' },
    badges,
    el(
      'p',
      { class: 'byline' },
      el('span', { class: 'author', text: idea.name?.trim() || 'Anonymous' }),
      idea.github
        ? [' · ', externalLink(`https://github.com/${encodeURIComponent(idea.github)}`, `@${idea.github}`)]
        : null,
      ' · ',
      el('time', { datetime: idea.created_at, title: new Date(idea.created_at).toLocaleString(), text: relativeTime(idea.created_at) }),
    ),
  );

  let reactions;
  if (idea.status === 'pending') {
    reactions = el('p', { class: 'pending-note', text: 'Waiting for review' });
  } else {
    const errorEl = el('p', { class: 'react-error', role: 'status' });
    reactions = el(
      'div',
      { class: 'reactions' },
      el('div', { class: 'react-row' }, reactionButton(idea, 'work_on', errorEl), reactionButton(idea, 'know_someone', errorEl)),
      errorEl,
    );
  }

  return el(
    'li',
    { class: 'card', 'data-id': idea.id },
    el(
      'article',
      { 'aria-labelledby': titleId },
      top,
      headline,
      more,
      details,
      reactions,
    ),
  );
}

function reactionButton(idea, kind, errorEl) {
  const key = `${idea.id}:${kind}`;
  const b = el('button', { type: 'button', class: 'react', 'data-focus-key': key });
  paintReaction(b, idea, kind);
  b.addEventListener('click', () => react(b, idea, kind, errorEl));
  return b;
}

function paintReaction(b, idea, kind) {
  const { label, flag, count } = REACTIONS[kind];
  const on = !!idea[flag];
  const busy = pending.has(`${idea.id}:${kind}`);
  b.setAttribute('aria-pressed', String(on));
  if (busy) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
  b.replaceChildren(
    el('span', { class: 'react-icon', 'aria-hidden': 'true', text: on ? '✓' : '+' }),
    el('span', { text: label }),
    el('span', { class: 'react-count', text: String(idea[count]) }),
  );
}

async function react(b, idea, kind, errorEl) {
  const key = `${idea.id}:${kind}`;
  if (pending.has(key)) return;
  const { flag, count } = REACTIONS[kind];
  const was = { on: !!idea[flag], count: idea[count] };

  // Optimistic update.
  idea[flag] = !was.on;
  idea[count] = was.count + (was.on ? -1 : 1);
  errorEl.textContent = '';
  pending.add(key);
  paintReaction(b, idea, kind);

  try {
    const on = await toggleReaction(idea.id, kind);
    // Trust the server if it disagrees with what we guessed.
    idea[flag] = on;
    idea[count] = was.count + (on ? 1 : 0) - (was.on ? 1 : 0);
  } catch (err) {
    console.error('Reaction failed', err);
    idea[flag] = was.on;
    idea[count] = was.count;
    errorEl.textContent = "Couldn't save that. Try again.";
  } finally {
    pending.delete(key);
    // Cards don't re-sort here so nothing jumps under the user's finger.
    paintReaction(b, idea, kind);
  }
}

function flashCard(id) {
  const card = $(`.card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 2500);
}

$('#sort').addEventListener('change', renderBoard);
$('#board-retry').addEventListener('click', () => loadBoard());
$('#add-another').addEventListener('click', () => showForm({ animate: true }));

// Reload when the tab regains focus. No realtime in v1.
function maybeRefresh() {
  if (view !== 'board' || document.visibilityState !== 'visible') return;
  if (pending.size || Date.now() - lastLoad < 3000) return;
  loadBoard();
}
window.addEventListener('focus', maybeRefresh);
document.addEventListener('visibilitychange', maybeRefresh);

// ============================================================
// Copy link
// ============================================================

for (const btn of $$('[data-copy-link]')) {
  const status = btn.nextElementSibling;
  let timer;
  btn.addEventListener('click', async () => {
    const ok = await copyText(SITE_URL);
    status.textContent = ok ? 'Link copied.' : `Copy this link: ${SITE_URL}`;
    clearTimeout(timer);
    timer = setTimeout(() => (status.textContent = ''), 3000);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-secure contexts.
    const ta = el('textarea', { readonly: true, class: 'offscreen' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
    return ok;
  }
}

// ============================================================
// Helpers
// ============================================================

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

// Links off the site open in a new tab, and say so to screen readers.
function externalLink(href, text) {
  return el(
    'a',
    { href, target: '_blank', rel: 'noopener noreferrer' },
    text,
    el('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }),
  );
}

function truncate(text) {
  const cut = text.slice(0, TRUNCATE_AT);
  const space = cut.lastIndexOf(' ');
  return `${(space > TRUNCATE_AT * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];
function relativeTime(iso) {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(secs);
  if (abs < 60) return 'just now';
  const [unit, size] = UNITS.find(([, s]) => abs >= s);
  return rtf.format(Math.round(secs / size), unit);
}

// ============================================================
// Start
// ============================================================

if (isDemo) $('#demo-banner').hidden = false;

// Returning visitors go straight to the board; first-timers start at step 1.
if (storage.get(SUBMITTED_KEY) === '1') showBoard();
else showForm();
