// SQLite storage for wswb. Uses Node's built-in node:sqlite (Node 22.13+), so
// there is nothing to npm install.
//
// Access rules that Supabase used to enforce now live here and in server.js:
// the API can insert ideas, list the board, and toggle reactions. Emails and
// browser IDs never leave the server.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const KINDS = ['work_on', 'know_someone'];
export const EVIDENCE = ['one_of_them', 'talked_to_them', 'hunch'];
export const ROLES = ['code', 'design', 'users', 'testing', 'organizing', 'idea_only'];
export const STATUSES = ['pending', 'live', 'hidden'];

const SCHEMA = `
create table if not exists ideas (
  id          text primary key,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  idea        text not null check (length(idea) between 3 and 1000),
  who         text not null check (length(who) between 3 and 200),
  pain        text not null check (length(pain) between 3 and 1000),
  why_tech    text check (length(why_tech) <= 600),
  evidence    text check (evidence in ('one_of_them', 'talked_to_them', 'hunch')),
  smallest    text check (length(smallest) <= 600),
  help_roles  text not null default '[]' check (json_valid(help_roles)),
  name        text check (length(name) <= 80),
  github      text check (length(github) <= 39),
  email       text check (length(email) <= 254),
  submitter   text not null,
  status      text not null default 'live' check (status in ('pending', 'live', 'hidden'))
);
create index if not exists ideas_created_at on ideas (created_at);

create table if not exists reactions (
  idea_id     text not null references ideas (id) on delete cascade,
  kind        text not null check (kind in ('work_on', 'know_someone')),
  voter       text not null,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (idea_id, kind, voter)
);
`;

export function openDb(file = process.env.DATABASE_PATH || path.resolve('data/wswb.db')) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function createStore(db) {
  const insertIdea = db.prepare(`
    insert into ideas (id, idea, who, pain, why_tech, evidence, smallest, help_roles, name, github, email, submitter, status)
    values (:id, :idea, :who, :pain, :why_tech, :evidence, :smallest, :help_roles, :name, :github, :email, :submitter, :status)
    on conflict (id) do nothing
  `);

  // The board: live ideas plus the caller's own pending ones. Never returns email or submitter.
  const listIdeas = db.prepare(`
    select i.id, i.created_at, i.idea, i.who, i.pain, i.why_tech, i.evidence,
           i.smallest, i.help_roles, i.name, i.github, i.status,
           i.submitter = :voter as is_mine,
           (select count(*) from reactions r where r.idea_id = i.id and r.kind = 'work_on') as work_on_count,
           (select count(*) from reactions r where r.idea_id = i.id and r.kind = 'know_someone') as know_someone_count,
           exists (select 1 from reactions r where r.idea_id = i.id and r.kind = 'work_on' and r.voter = :voter) as i_work_on,
           exists (select 1 from reactions r where r.idea_id = i.id and r.kind = 'know_someone' and r.voter = :voter) as i_know_someone
    from ideas i
    where i.status = 'live' or (i.status = 'pending' and i.submitter = :voter)
    order by i.created_at desc
  `);

  const isLive = db.prepare(`select 1 from ideas where id = ? and status = 'live'`);
  const deleteReaction = db.prepare(`delete from reactions where idea_id = ? and kind = ? and voter = ?`);
  const insertReaction = db.prepare(
    `insert into reactions (idea_id, kind, voter) values (?, ?, ?) on conflict do nothing`,
  );

  return {
    /** Insert an idea. Re-sending the same id is a no-op, so client retries are safe. */
    submitIdea(row, status = 'live') {
      insertIdea.run({ ...row, help_roles: JSON.stringify(row.help_roles), status });
    },

    listIdeas(voter) {
      return listIdeas.all({ voter }).map((r) => ({
        ...r,
        help_roles: JSON.parse(r.help_roles),
        is_mine: r.is_mine === 1,
        i_work_on: r.i_work_on === 1,
        i_know_someone: r.i_know_someone === 1,
      }));
    },

    /** Turn a reaction on or off. Returns true if it is now on, null if the idea isn't live. */
    toggleReaction(ideaId, kind, voter) {
      if (!isLive.get(ideaId)) return null;
      const { changes } = deleteReaction.run(ideaId, kind, voter);
      if (changes > 0) return false;
      insertReaction.run(ideaId, kind, voter);
      return true;
    },
  };
}
