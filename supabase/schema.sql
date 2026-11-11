-- wswb.fyi database schema. Paste this into the Supabase SQL editor and run it once.

-- Ideas. The browser generates id itself so it never has to read the row back.
create table public.ideas (
  id          uuid primary key,
  created_at  timestamptz not null default now(),
  idea        text not null check (char_length(idea) between 3 and 1000),
  who         text not null check (char_length(who) between 3 and 200),
  pain        text not null check (char_length(pain) between 3 and 1000),
  why_tech    text check (char_length(why_tech) <= 600),
  evidence    text check (evidence in ('one_of_them', 'talked_to_them', 'hunch')),
  smallest    text check (char_length(smallest) <= 600),
  help_roles  text[] not null default '{}'
              check (help_roles <@ array['code','design','users','testing','organizing','idea_only']),
  name        text check (char_length(name) <= 80),
  github      text check (github ~ '^[A-Za-z0-9](-?[A-Za-z0-9])*$' and char_length(github) <= 39),
  email       text check (char_length(email) <= 254),
  submitter   uuid not null,
  status      text not null default 'live' check (status in ('pending', 'live', 'hidden'))
);

create table public.reactions (
  idea_id     uuid not null references public.ideas (id) on delete cascade,
  kind        text not null check (kind in ('work_on', 'know_someone')),
  voter       uuid not null,
  created_at  timestamptz not null default now(),
  primary key (idea_id, kind, voter)
);

alter table public.ideas enable row level security;
alter table public.reactions enable row level security;

-- Anyone can add an idea. Nobody can read, change, or delete rows directly.
create policy "anyone can submit" on public.ideas
  for insert to anon, authenticated
  with check (status = 'live');

revoke all on public.ideas, public.reactions from anon, authenticated;
-- Column list leaves out created_at and status, so the defaults always apply.
grant insert (id, idea, who, pain, why_tech, evidence, smallest, help_roles, name, github, email, submitter)
  on public.ideas to anon, authenticated;

-- The board: live ideas plus the caller's own pending ones. Never returns email or submitter.
-- github is public: it's shown on the card as a link to the person's profile.
create function public.list_ideas(p_voter uuid)
returns table (
  id uuid, created_at timestamptz, idea text, who text, pain text,
  why_tech text, evidence text, smallest text, help_roles text[], name text, github text,
  status text, is_mine boolean,
  work_on_count int, know_someone_count int,
  i_work_on boolean, i_know_someone boolean
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.created_at, i.idea, i.who, i.pain, i.why_tech, i.evidence,
         i.smallest, i.help_roles, i.name, i.github, i.status,
         i.submitter = p_voter,
         (select count(*) from reactions r where r.idea_id = i.id and r.kind = 'work_on')::int,
         (select count(*) from reactions r where r.idea_id = i.id and r.kind = 'know_someone')::int,
         exists (select 1 from reactions r where r.idea_id = i.id and r.kind = 'work_on' and r.voter = p_voter),
         exists (select 1 from reactions r where r.idea_id = i.id and r.kind = 'know_someone' and r.voter = p_voter)
  from ideas i
  where i.status = 'live'
     or (i.status = 'pending' and i.submitter = p_voter)
  order by i.created_at desc;
$$;

-- Turns a reaction on or off. Returns true if it is now on.
create function public.toggle_reaction(p_idea uuid, p_kind text, p_voter uuid)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
begin
  if not exists (select 1 from ideas where id = p_idea and status = 'live') then
    raise exception 'idea not found';
  end if;
  delete from reactions where idea_id = p_idea and kind = p_kind and voter = p_voter;
  if found then
    return false;
  end if;
  insert into reactions (idea_id, kind, voter) values (p_idea, p_kind, p_voter)
    on conflict do nothing;
  return true;
end;
$$;

revoke execute on function public.list_ideas(uuid), public.toggle_reaction(uuid, text, uuid) from public;
grant execute on function public.list_ideas(uuid), public.toggle_reaction(uuid, text, uuid) to anon, authenticated;
