// Data layer. The UI only calls submitIdea, listIdeas, and toggleReaction.
// With a Supabase URL in config.js these talk to Supabase; without one they
// use an in-memory demo adapter seeded from demo-data.js.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { DEMO_IDEAS } from './demo-data.js';

// Pinned to an exact version on purpose. Never use a range or @latest.
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const isDemo = !SUPABASE_URL;

// ---------- localStorage that never throws ----------

export const storage = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch { return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// ---------- IDs ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers: RFC 4122 v4 from random bytes.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// The browser ID identifies this browser for "Yours" and for reactions.
// If localStorage is unavailable it lives in memory for this session only.
const VOTER_KEY = 'wswb.voter';
let voter = storage.get(VOTER_KEY);
if (!voter || !UUID_RE.test(voter)) {
  voter = newId();
  storage.set(VOTER_KEY, voter);
}

// ---------- Supabase adapter ----------

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = import(SUPABASE_JS_URL)
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
      )
      .catch((err) => {
        clientPromise = null; // let the next call try loading again
        throw err;
      });
  }
  return clientPromise;
}

const supabaseAdapter = {
  async submitIdea(row) {
    const sb = await getClient();
    // No .select(): the browser can't read ideas, so ask for nothing back.
    const { error } = await sb.from('ideas').insert({ ...row, submitter: voter });
    // 23505 = duplicate id. The client reuses the same id when retrying, so
    // this means an earlier attempt actually got through.
    if (error && error.code !== '23505') throw error;
  },

  async listIdeas() {
    const sb = await getClient();
    const { data, error } = await sb.rpc('list_ideas', { p_voter: voter });
    if (error) throw error;
    return data ?? [];
  },

  async toggleReaction(ideaId, kind) {
    const sb = await getClient();
    const { data, error } = await sb.rpc('toggle_reaction', {
      p_idea: ideaId,
      p_kind: kind,
      p_voter: voter,
    });
    if (error) throw error;
    return data === true;
  },
};

// ---------- Demo adapter (in memory, nothing saved) ----------

function createDemoAdapter() {
  const now = Date.now();
  const ideas = DEMO_IDEAS.map(({ ageHours, work_on_count, know_someone_count, ...rest }) => ({
    ...rest,
    created_at: new Date(now - ageHours * 3600_000).toISOString(),
    status: 'live',
    submitter: null,
    example: true,
    base: { work_on: work_on_count, know_someone: know_someone_count },
  }));
  const mine = new Set(); // `${ideaId}:${kind}` reactions from this browser
  const wait = () => new Promise((r) => setTimeout(r, 250));

  return {
    async submitIdea(row) {
      await wait();
      if (ideas.some((i) => i.id === row.id)) return;
      ideas.push({
        ...row,
        created_at: new Date().toISOString(),
        status: 'live',
        submitter: voter,
        example: false,
        base: { work_on: 0, know_someone: 0 },
      });
    },

    async listIdeas() {
      await wait();
      return ideas
        .filter((i) => i.status === 'live' || (i.status === 'pending' && i.submitter === voter))
        .map((i) => {
          const onWork = mine.has(`${i.id}:work_on`);
          const onKnow = mine.has(`${i.id}:know_someone`);
          return {
            id: i.id,
            created_at: i.created_at,
            idea: i.idea,
            who: i.who,
            pain: i.pain,
            why_tech: i.why_tech,
            evidence: i.evidence,
            smallest: i.smallest,
            help_roles: i.help_roles,
            name: i.name,
            status: i.status,
            is_mine: i.submitter === voter,
            work_on_count: i.base.work_on + (onWork ? 1 : 0),
            know_someone_count: i.base.know_someone + (onKnow ? 1 : 0),
            i_work_on: onWork,
            i_know_someone: onKnow,
            example: i.example,
          };
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    async toggleReaction(ideaId, kind) {
      await wait();
      if (!ideas.some((i) => i.id === ideaId && i.status === 'live')) {
        throw new Error('idea not found');
      }
      const key = `${ideaId}:${kind}`;
      if (mine.delete(key)) return false;
      mine.add(key);
      return true;
    },
  };
}

// ---------- Public interface ----------

const adapter = isDemo ? createDemoAdapter() : supabaseAdapter;

/** Save a new idea. `row` has id plus the form fields; submitter is added here. */
export const submitIdea = (row) => adapter.submitIdea(row);

/** Live ideas plus this browser's pending ones, newest first. */
export const listIdeas = () => adapter.listIdeas();

/** Toggle a reaction. Resolves to true if it is now on. */
export const toggleReaction = (ideaId, kind) => adapter.toggleReaction(ideaId, kind);
