create table if not exists public.operation_alerts (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  observed_at timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  frp numeric not null default 0,
  intensity numeric not null default 0,
  sensors text not null,
  level text not null check (level in ('critical', 'moderate', 'watch')),
  status text not null default 'new' check (status in ('new', 'acknowledged', 'dispatched', 'resolved')),
  ideam_notification_status text not null default 'pending_configuration',
  ideam_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operation_alerts_observed_at_idx on public.operation_alerts (observed_at desc);
create index if not exists operation_alerts_status_idx on public.operation_alerts (status);
alter table public.operation_alerts enable row level security;

create table if not exists public.alert_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid references public.operation_alerts(id) on delete cascade,
  recipient text not null,
  subject text not null,
  delivery_status text not null check (delivery_status in ('sent', 'failed', 'pending_configuration')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists alert_delivery_logs_created_at_idx on public.alert_delivery_logs (created_at desc);
alter table public.alert_delivery_logs enable row level security;
