-- Create online_users table to track active users
create table if not exists public.online_users (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  last_seen timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Create index for faster queries
create index if not exists online_users_user_id_idx on public.online_users(user_id);
create index if not exists online_users_last_seen_idx on public.online_users(last_seen);

-- Enable Realtime for the online_users table
-- Note: This may need to be done manually in the Supabase Dashboard if the publication doesn't exist
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.online_users;
  end if;
end $$;

-- Function to clean up old records (users inactive for more than 5 minutes)
create or replace function public.cleanup_old_online_users()
returns void as $$
begin
  delete from public.online_users
  where last_seen < now() - interval '5 minutes';
end;
$$ language plpgsql;
