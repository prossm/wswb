# wswb.fyi

**What should we build?** A one-page site where members of The Product Group Hudson Valley propose things the group could build together, then see and react to everyone else's ideas.

Visitors answer the open question first, before they see any other ideas, so nobody gets anchored on someone else's answer. Then they sharpen the idea (who it's for, the problem, the smallest version), say whether they'd help, and land on the board. People can optionally add their GitHub username, which shows on their card as a link to their profile.

"wswb" is a working title. The site and repo may be renamed once the group picks a project.

## How it's built

Plain HTML, CSS, and JavaScript in the browser. A small Node server with **no dependencies** serves the page and a JSON API, and stores everything in a SQLite file. No framework, no build step, no `npm install`.

| File | What it does |
| --- | --- |
| `index.html` | The page: the 3-step form and the board |
| `styles.css` | All styling, light and dark mode |
| `app.js` | UI and step navigation |
| `transitions.js` | Soft page-turn fade between screens (skipped for reduced motion) |
| `data.js` | Talks to the API, or to the demo adapter. The UI only calls `submitIdea`, `listIdeas`, `toggleReaction` |
| `demo-data.js` | Sample ideas used in demo mode |
| `config.js` | `API_URL` (`/api`). Empty means demo mode |
| `server/server.js` | Serves the page files and the API |
| `server/db.js` | SQLite schema and queries |
| `server/admin.js` | Organizer commands: list, hide, approve, emails, backup |
| `Dockerfile`, `disco.json` | How [Disco](https://disco.cloud) builds and runs it |

### Keyboard shortcuts

On the form (Ctrl instead of ⌘ on Windows and Linux):

| Keys | Does |
| --- | --- |
| ⌘ Enter | The step's main button: Next, or "Share my idea" on step 3 |
| ⌘ [ | Previous question |
| ⌘ ] | Next question, if this step's required fields are filled in |

### The API

| Request | Does |
| --- | --- |
| `GET /api/ideas?voter=<id>` | The board: live ideas plus your own pending ones, with reaction counts |
| `POST /api/ideas` | Submit an idea |
| `POST /api/reactions` | Toggle a reaction: `{ idea, kind, voter }` → `{ on }` |
| `GET /api/health` | `{ ok: true }` |

The API never returns emails or other people's browser IDs. The server checks every field's length and format, ignores any attempt to set `status` or `created_at`, and rate-limits each IP address.

## Run it locally

You need Node 22.13 or newer (`node -v`).

```sh
node server/server.js
```

Open http://localhost:8000. Ideas are saved to `data/wswb.db` in the repo folder (git ignores it). Delete that file to start fresh.

To start over as a first-time visitor, clear the site's localStorage (browser dev tools → Application → Local Storage), or open a private window.

### Demo mode

Add `?demo` to the URL (http://localhost:8000/?demo) to use four sample ideas held in memory instead of the database. A banner says "Demo mode: nothing is saved." Setting `API_URL` to `''` in `config.js` does the same thing permanently, and then any static server works too (`npx serve .`).

## Deploy

The site runs on the `disco.soundcurious.com` Disco server, alongside soundcurious, almanac and rei-brand-scout. **Every push to `main` deploys.** Disco builds the `Dockerfile`, serves it at `wswb.fyi`, and handles HTTPS.

The database lives on a Disco volume named `data`, mounted at `/data`, so it survives deploys.

### First-time setup (already done)

```sh
disco projects:add --disco disco.soundcurious.com \
  --name wswb --github prossm/wswb --branch main --domain wswb.fyi
```

DNS at Porkbun: one A record for `wswb.fyi` pointing at the Disco server's IP (`dig +short disco.soundcurious.com`). Delete any parking records Porkbun added for the apex. Once the name resolves, Disco gets the certificate on its own.

### Watching a deploy

```sh
disco deploy:list --disco disco.soundcurious.com --project wswb
disco logs --disco disco.soundcurious.com --project wswb
```

## Moderation

Ideas go live as soon as they're submitted. Organizers remove bad ones after the fact. There's no admin UI in v1; you run commands on the server with `disco run`:

```sh
disco run --disco disco.soundcurious.com --project wswb "node server/admin.js list"
```

| Command | Does |
| --- | --- |
| `list` | Live ideas, newest first, with short ids and reaction counts |
| `list --all` | Every idea, including hidden and pending ones |
| `show <id>` | Everything about one idea, including email |
| `hide <id>` | Take an idea off the board. Its reactions are kept |
| `live <id>` | Put an idea back on the board, or approve a pending one |
| `pending <id>` | Move an idea back to waiting for review |
| `emails` | Everyone who left an email, with their idea |
| `backup <file>` | Write a consistent copy of the database |

`<id>` can be just the first 8 characters shown by `list`.

### Spam

Defenses in v1: a hidden honeypot field, length and format checks on the server and in the database, and per-IP rate limits (20 ideas an hour, 300 reactions per 10 minutes). These stop casual bots, not a determined attacker. If spam shows up, add [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) in front of submit.

### Switch to approval-first

To approve ideas before they're public:

```sh
disco env:set --disco disco.soundcurious.com --project wswb NEW_IDEA_STATUS=pending
```

New ideas then arrive as `pending`. The person who posted it still sees their own card on the board, marked "Waiting for review" with no reaction buttons. Approve one with `admin.js live <id>`. No code change is needed. To switch back, set `NEW_IDEA_STATUS=live`.

## Backups

The database is one file on the server, so back it up:

```sh
disco volumes:export --disco disco.soundcurious.com --project wswb --volume data --output wswb-backup.tar.gz
```

Or, for a copy that's safe to take while the site is busy, run `admin.js backup /data/backup.db` first and export after.

## Known gaps in v1

- Clearing localStorage gives a browser a new ID, so someone could react twice. Fine for a meetup-sized group.
- No realtime updates. The board reloads when you open it and when the tab regains focus.
- No analytics.
