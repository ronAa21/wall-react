-- Run this once in the Supabase SQL editor.
-- It creates the wall's table, opens it for anonymous read/insert, and
-- publishes it to Realtime so the feed updates without a refresh.

create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  content     text not null check (char_length(content) between 1 and 280),
  author_name text not null default 'Guest',
  created_at  timestamptz not null default now(),
  attachments jsonb not null default '[]'::jsonb
);

alter table public.posts
  add column if not exists attachments jsonb not null default '[]'::jsonb;

create index if not exists posts_created_at_idx
  on public.posts (created_at desc);

alter table public.posts enable row level security;

-- The wall is public by design: anyone holding the publishable key can read
-- and post. Tighten these if you later add real user accounts.
drop policy if exists "posts are readable by everyone" on public.posts;
create policy "posts are readable by everyone"
  on public.posts for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone can post" on public.posts;
create policy "anyone can post"
  on public.posts for insert
  to anon, authenticated
  with check (true);

-- Needed so renaming your profile can rename the posts you already wrote.
-- Trade-off: with no user accounts, this also lets anyone rewrite anyone
-- else's posts. Remove it if that matters more than the rename.
drop policy if exists "authors can rename their posts" on public.posts;
create policy "authors can rename their posts"
  on public.posts for update
  to anon, authenticated
  using (true)
  with check (true);

-- Realtime: without this, postgres_changes never fires.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;
end $$;

-- Attachments live in a public Storage bucket; the post row keeps their URLs.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

drop policy if exists "anyone can upload attachments" on storage.objects;
create policy "anyone can upload attachments"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'attachments');

-- Makes PostgREST pick the new table up immediately instead of waiting for
-- its schema cache to expire.
notify pgrst, 'reload schema';
