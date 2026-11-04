-- Allow the web profile editor to record explicit preference edits as profile
-- imports. The "web" provider is treated as a projection-override source (like
-- the SMS transports) so a user's explicit edit supersedes prior facts for the
-- same slot.
alter table public.profile_imports
  drop constraint if exists profile_imports_provider_check,
  add constraint profile_imports_provider_check
    check (provider in ('claude', 'chatgpt', 'manual', 'mcp', 'mock', 'other', 'linq', 'sendblue', 'web'));
