create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create schema if not exists private;

create or replace function private.dispatch_notifications()
returns void
language plpgsql
security definer
set search_path = private, vault, extensions, public, pg_temp
as $$
declare
  v_endpoint text;
  v_secret text;
begin
  select decrypted_secret into v_endpoint
  from vault.decrypted_secrets
  where name = 'send_notifications_url'
  limit 1;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ulala_cron_secret'
  limit 1;

  if v_endpoint is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_endpoint,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

select cron.schedule(
  'ulala-send-notifications',
  '* * * * *',
  $$select private.dispatch_notifications()$$
)
where not exists (
  select 1 from cron.job where jobname = 'ulala-send-notifications'
);
