// Organizer commands. There's no admin UI in v1; run these on the server:
//
//   disco run --disco disco.soundcurious.com --project wswb "node server/admin.js list"
//
// Commands:
//   list [--all]        live ideas (or every idea, with --all)
//   show <id>           everything about one idea, including email
//   hide <id>           take an idea off the board (reactions are kept)
//   live <id>           put an idea on the board (approve a pending one, or un-hide)
//   pending <id>        move an idea back to waiting for review
//   emails              everyone who left an email, with their idea
//   backup <file>       write a consistent copy of the database to <file>
//
// <id> can be the first 8+ characters of the idea's id.

import { openDb, STATUSES } from './db.js';

const db = openDb();
const [cmd, arg] = process.argv.slice(2);

const excerpt = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function findId(prefix) {
  if (!prefix || prefix.length < 8) fail('Give an idea id (at least the first 8 characters).');
  const rows = db.prepare(`select id from ideas where id like ? || '%'`).all(prefix.toLowerCase());
  if (rows.length === 0) fail(`No idea matches ${prefix}.`);
  if (rows.length > 1) fail(`${prefix} matches ${rows.length} ideas. Use more characters.`);
  return rows[0].id;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function setStatus(status) {
  const id = findId(arg);
  db.prepare(`update ideas set status = ? where id = ?`).run(status, id);
  const row = db.prepare(`select id, status, idea from ideas where id = ?`).get(id);
  console.log(`${row.id.slice(0, 8)}  now ${row.status}  ${excerpt(row.idea)}`);
}

switch (cmd) {
  case 'list': {
    const all = arg === '--all';
    const rows = db
      .prepare(
        `select i.id, i.created_at, i.status, i.name, i.idea,
                (select count(*) from reactions r where r.idea_id = i.id and r.kind = 'work_on') as w,
                (select count(*) from reactions r where r.idea_id = i.id and r.kind = 'know_someone') as k
         from ideas i ${all ? '' : `where i.status = 'live'`} order by i.created_at desc`,
      )
      .all();
    if (!rows.length) console.log(all ? 'No ideas yet.' : 'No live ideas. Try: list --all');
    for (const r of rows) {
      console.log(
        `${r.id.slice(0, 8)}  ${r.created_at.slice(0, 10)}  ${r.status.padEnd(7)}  ` +
          `work:${r.w} know:${r.k}  ${(r.name || 'Anonymous').padEnd(14).slice(0, 14)}  ${excerpt(r.idea)}`,
      );
    }
    break;
  }

  case 'show': {
    const row = db.prepare(`select * from ideas where id = ?`).get(findId(arg));
    for (const [k, v] of Object.entries(row)) console.log(`${k.padEnd(11)} ${v ?? ''}`);
    break;
  }

  case 'hide':
    setStatus('hidden');
    break;
  case 'live':
  case 'approve':
    setStatus('live');
    break;
  case 'pending':
    setStatus('pending');
    break;

  case 'emails': {
    const rows = db
      .prepare(`select id, name, email, idea from ideas where email is not null order by created_at desc`)
      .all();
    if (!rows.length) console.log('Nobody has left an email yet.');
    for (const r of rows) console.log(`${r.email}  ${r.name || 'Anonymous'}  (${r.id.slice(0, 8)}) ${excerpt(r.idea, 50)}`);
    break;
  }

  case 'backup': {
    if (!arg) fail('Usage: backup <file>');
    db.prepare('vacuum into ?').run(arg);
    console.log(`Wrote ${arg}`);
    break;
  }

  default:
    console.log(`Usage: node server/admin.js <list [--all] | show <id> | hide <id> | live <id> | pending <id> | emails | backup <file>>
Statuses: ${STATUSES.join(', ')}`);
}

db.close();
