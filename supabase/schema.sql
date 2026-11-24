-- SocialPortal backend schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent: re-running it will not destroy existing data.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null check (username ~ '^[A-Za-z0-9._-]{3,30}$'),
  first_name  text,
  last_name   text,
  email       text,
  birthday    date,
  gender      text check (gender in ('female', 'male', 'rather-not-say')),
  avatar_url  text,
  bio         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Usernames are unique regardless of case.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 5000),
  image_url   text,
  visibility  text not null default 'public' check (visibility in ('public', 'group')),
  created_at  timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_id_idx on public.posts (author_id);

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on public.comments (post_id);

create table if not exists public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  caption    text,
  image_url  text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.profiles (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  location    text,
  starts_at   timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Grants (RLS below decides what each row set may contain)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.posts, public.post_likes, public.comments,
                public.follows, public.stories, public.events to anon, authenticated;
grant insert, update, delete on public.profiles, public.posts, public.post_likes,
                public.comments, public.follows, public.stories, public.events to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at upkeep
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Create a profile for every new auth user, using the metadata sent by the
-- sign-up form. Runs as definer so it works even before email confirmation.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
  bday  date;
begin
  uname := lower(coalesce(nullif(new.raw_user_meta_data ->> 'username', ''),
                          'user_' || substr(replace(new.id::text, '-', ''), 1, 8)));

  if coalesce(new.raw_user_meta_data ->> 'birthday', '') <> '' then
    begin
      bday := (new.raw_user_meta_data ->> 'birthday')::date;
    exception when others then
      bday := null;
    end;
  end if;

  begin
    insert into public.profiles (id, username, first_name, last_name, email, birthday, gender)
    values (new.id,
            uname,
            nullif(new.raw_user_meta_data ->> 'first_name', ''),
            nullif(new.raw_user_meta_data ->> 'last_name', ''),
            new.email,
            bday,
            nullif(new.raw_user_meta_data ->> 'gender', ''));
  exception when unique_violation then
    insert into public.profiles (id, username, first_name, last_name, email, birthday, gender)
    values (new.id,
            uname || '_' || substr(replace(new.id::text, '-', ''), 1, 4),
            nullif(new.raw_user_meta_data ->> 'first_name', ''),
            nullif(new.raw_user_meta_data ->> 'last_name', ''),
            new.email,
            bday,
            nullif(new.raw_user_meta_data ->> 'gender', ''));
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Username availability check used by the sign-up wizard
-- ---------------------------------------------------------------------------

create or replace function public.username_available(p_username text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(trim(p_username))
  );
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles   enable row level security;
alter table public.posts      enable row level security;
alter table public.post_likes enable row level security;
alter table public.comments   enable row level security;
alter table public.follows    enable row level security;
alter table public.stories    enable row level security;
alter table public.events     enable row level security;

-- profiles: public read, only the owner may write their own row
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles
  for select using (true);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- posts: public read, author writes
drop policy if exists "posts are public" on public.posts;
create policy "posts are public" on public.posts
  for select using (true);

drop policy if exists "insert own posts" on public.posts;
create policy "insert own posts" on public.posts
  for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "update own posts" on public.posts;
create policy "update own posts" on public.posts
  for update to authenticated using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "delete own posts" on public.posts;
create policy "delete own posts" on public.posts
  for delete to authenticated using (auth.uid() = author_id);

-- likes: public read, own rows only
drop policy if exists "likes are public" on public.post_likes;
create policy "likes are public" on public.post_likes
  for select using (true);

drop policy if exists "insert own likes" on public.post_likes;
create policy "insert own likes" on public.post_likes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "delete own likes" on public.post_likes;
create policy "delete own likes" on public.post_likes
  for delete to authenticated using (auth.uid() = user_id);

-- comments: public read, author writes
drop policy if exists "comments are public" on public.comments;
create policy "comments are public" on public.comments
  for select using (true);

drop policy if exists "insert own comments" on public.comments;
create policy "insert own comments" on public.comments
  for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "delete own comments" on public.comments;
create policy "delete own comments" on public.comments
  for delete to authenticated using (auth.uid() = author_id);

-- follows: public read, own rows only
drop policy if exists "follows are public" on public.follows;
create policy "follows are public" on public.follows
  for select using (true);

drop policy if exists "insert own follows" on public.follows;
create policy "insert own follows" on public.follows
  for insert to authenticated with check (auth.uid() = follower_id);

drop policy if exists "delete own follows" on public.follows;
create policy "delete own follows" on public.follows
  for delete to authenticated using (auth.uid() = follower_id);

-- stories: public read, author writes
drop policy if exists "stories are public" on public.stories;
create policy "stories are public" on public.stories
  for select using (true);

drop policy if exists "insert own stories" on public.stories;
create policy "insert own stories" on public.stories
  for insert to authenticated with check (auth.uid() = author_id);

drop policy if exists "delete own stories" on public.stories;
create policy "delete own stories" on public.stories
  for delete to authenticated using (auth.uid() = author_id);

-- events: public read, creator writes
drop policy if exists "events are public" on public.events;
create policy "events are public" on public.events
  for select using (true);

drop policy if exists "insert own events" on public.events;
create policy "insert own events" on public.events
  for insert to authenticated with check (auth.uid() = creator_id);

drop policy if exists "delete own events" on public.events;
create policy "delete own events" on public.events
  for delete to authenticated using (auth.uid() = creator_id);
