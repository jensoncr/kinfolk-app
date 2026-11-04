alter table public.roommate_contact_invites
  add column if not exists destination_phone_e164 text,
  add column if not exists reply_code_hash text,
  add column if not exists reply_code_hint text,
  add column if not exists reply_code_expires_at timestamptz,
  add column if not exists accepted_phone_e164 text,
  add column if not exists started_setup_at timestamptz,
  add column if not exists sms_provider text,
  add column if not exists sms_provider_chat_id text,
  add column if not exists sms_provider_message_id text,
  add column if not exists sms_delivery_status text,
  add column if not exists sms_service text,
  add column if not exists delivery_error text;

create index if not exists roommate_contact_invites_reply_code_idx
  on public.roommate_contact_invites(reply_code_hash, reply_code_expires_at desc)
  where reply_code_hash is not null and revoked_at is null;

create index if not exists roommate_contact_invites_destination_phone_idx
  on public.roommate_contact_invites(destination_phone_e164)
  where destination_phone_e164 is not null and revoked_at is null;
