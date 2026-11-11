# wswb.fyi

**What should we build?** A one-page site where members of The Product Group Hudson Valley propose things the group could build together, then see and react to everyone else's ideas.

People can optionally add their GitHub username, which shows on their card as a link to their profile.

Visitors answer the open question first, before they see any other ideas, so nobody gets anchored on someone else's answer. Then they sharpen the idea (who it's for, the problem, the smallest version), say whether they'd help, and land on the board.

"wswb" is a working title. The site and repo may be renamed once the group picks a project.

## How it's built

Plain HTML, CSS, and JavaScript. No framework, no build step, no `npm install`.

| File | What it does |
| --- | --- |
| `index.html` | The page: the 3-step form and the board |
| `styles.css` | All styling, light and dark mode |
| `app.js` | UI and step navigation |
| `data.js` | Talks to Supabase, or to the demo adapter. The UI only calls `submitIdea`, `listIdeas`, `toggleReaction` |
| `demo-data.js` | Sample ideas used in demo mode |
| `config.js` | `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Empty means demo mode |
| `CNAME` | Custom domain for GitHub Pages (`wswb.fyi`) |
| `supabase/schema.sql` | Tables, access rules, and database functions |

## Run it locally

Any static file server works. With Node installed:

```sh
npx serve .
```

Then open the URL it prints (usually http://localhost:3000).

Opening `index.html` straight from disk (`file://`) won't work, because browsers block ES modules there.

### Demo mode

If `config.js` has no Supabase URL (the default in this repo until someone fills it in), the site runs on four sample ideas held in memory. A banner says "Demo mode: nothing is saved." Use this to work on the UI without a Supabase project.

To start over as a first-time visitor, clear the site's localStorage (browser dev tools → Application → Local Storage), or open a private window.

## Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste in all of `supabase/schema.sql`, and run it.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. Put them in `config.js`:

   ```js
   export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

5. Commit and push.

The anon key is meant to be public. The access rules in `schema.sql` only let the browser insert ideas and call two functions (`list_ideas` and `toggle_reaction`). Nobody can read emails or browser IDs through the API. **Never** put the `service_role` key in this repo.

Free Supabase projects pause after a stretch with no activity. When that happens the site shows "We couldn't reach the server…" and keeps people's answers in their browser. Un-pause the project from the Supabase dashboard.

## Deploy (GitHub Pages)

1. In the repo on GitHub: **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. Under **Custom domain**, enter `wswb.fyi` (the `CNAME` file already says this). Save.
4. Once the DNS check passes, tick **Enforce HTTPS**. The certificate can take up to an hour to appear.
5. Verify the domain for the GitHub org so nobody else can claim it: **Org Settings → Pages → Add a domain**, then add the TXT record GitHub gives you.

Every push to `main` redeploys within a minute or two.

### DNS for wswb.fyi

At the domain registrar, set these records on the apex (`@`):

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| AAAA | @ | 2606:50c0:8000::153 |
| AAAA | @ | 2606:50c0:8001::153 |
| AAAA | @ | 2606:50c0:8002::153 |
| AAAA | @ | 2606:50c0:8003::153 |
| CNAME | www | `<org-name>.github.io` |

Plus the TXT record from the domain verification step above. Check GitHub's [custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) if these IPs ever change.

## Moderation

Ideas go live as soon as they're submitted. Organizers remove bad ones after the fact. There's no admin UI in v1; everything happens in the Supabase dashboard.

### Hide an idea

1. Supabase → **Table Editor** → `ideas`.
2. Find the row and change `status` to `hidden`.

It disappears from the board the next time anyone loads it. Its reactions stay in the database. Set it back to `live` to restore it.

### Read submitters' emails

They're in the `email` column of the `ideas` table in the Table Editor. They never appear in the app.

### Spam

Defenses in v1: a hidden honeypot field, length checks in the database, and a column-level insert grant (the browser can't set `status` or `created_at`). These stop casual bots, not someone calling the API directly. If spam shows up, add [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) in front of submit.

### Switch to approval-first

If you'd rather approve ideas before they're public, run this in the SQL Editor:

```sql
alter table public.ideas alter column status set default 'pending';

drop policy "anyone can submit" on public.ideas;
create policy "anyone can submit" on public.ideas
  for insert to anon, authenticated
  with check (status = 'pending');
```

New ideas then arrive as `pending`. The person who posted it still sees their own card on the board, marked "Waiting for review" with no reaction buttons. To approve one, set its `status` to `live` in the Table Editor. No code change is needed.

To switch back, run the same thing with `'live'` in both places.

## Known gaps in v1

- Clearing localStorage gives a browser a new ID, so someone could react twice. Fine for a meetup-sized group.
- No realtime updates. The board reloads when you open it and when the tab regains focus.
- No analytics.
