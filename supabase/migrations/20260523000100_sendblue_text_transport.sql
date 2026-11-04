alter table public.phone_verification_challenges
  drop constraint if exists phone_verification_challenges_provider_check,
  add constraint phone_verification_challenges_provider_check
    check (provider in ('linq', 'sendblue'));

alter table public.text_threads
  drop constraint if exists text_threads_provider_check,
  add constraint text_threads_provider_check
    check (provider in ('linq', 'sendblue'));

alter table public.text_messages
  drop constraint if exists text_messages_provider_check,
  add constraint text_messages_provider_check
    check (provider in ('linq', 'sendblue'));

alter table public.text_webhook_events
  drop constraint if exists text_webhook_events_provider_check,
  add constraint text_webhook_events_provider_check
    check (provider in ('linq', 'sendblue'));

alter table public.profile_imports
  drop constraint if exists profile_imports_provider_check,
  add constraint profile_imports_provider_check
    check (provider in ('claude', 'chatgpt', 'manual', 'mcp', 'mock', 'other', 'linq', 'sendblue'));
