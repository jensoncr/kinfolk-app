# Kinfolk Tech Stack

This document describes the intended product stack for Kinfolk. It is focused on the platform and integration choices, not the final page structure or internal data model.

## Product Architecture

Kinfolk should be a web-first network and housing-matching product with a trusted identity layer, a persistent messaging loop, a structured matching interview, and an optional contact import flow.

The core loop is:

1. Verify the user with LinkedIn.
2. Create or attach the Kinfolk user profile.
3. Verify the user's phone number through a native messaging handoff.
4. Keep the user reachable through SMS, WhatsApp, and email.
5. Run an optional conversational matching interview.
6. Offer optional contact import to accelerate network effects.

LinkedIn should be used for identity and professional credibility. Phone, email, and contact providers should be used for the actual network graph.

The conversational interview should be used for apartment and roommate matching. It should collect richer preference data than a form can usually capture: budget, neighborhoods, commute, move-in timing, lifestyle, sleep/work patterns, hosting/guest expectations, cleanliness, pets, dealbreakers, and what tradeoffs the user would actually make.

## Application Framework

Use **Next.js with the App Router** as the main application framework.

Recommended shape:

- `app/` for routes and layouts.
- Server Components by default.
- Client Components for auth buttons, messaging handoffs, contact picker, and realtime UI.
- Route handlers for webhooks and private API endpoints.
- Middleware or Clerk route protection for authenticated areas.

Deploy the app on **Render** (auto-deploys from `main`); use its preview/PR environments for fast iteration. Scheduled jobs run via Render's scheduler / pg_cron hitting the auth-gated `/api/jobs/*` routes (`x-kinfolk-job-secret`), not a `vercel.json` cron.

Use **Cloudflare** later if we need DNS, caching, bot protection, custom rules, or a stronger edge/security layer.

## Authentication

Use **Clerk** for authentication.

Initial auth providers:

- LinkedIn OIDC
- Email
- Google, optional

LinkedIn OIDC should be the main onboarding CTA because it gives us a high-trust professional identity without asking the user to fill out a profile from scratch.

Clerk responsibilities:

- Session management
- Social OAuth
- Account linking
- Hosted user/session security
- Auth webhooks
- Route protection

Kinfolk responsibilities:

- Store the app-specific user profile.
- Store normalized identity metadata.
- Decide onboarding state.
- Attach verified phone numbers and imported contacts.

## LinkedIn Integration

Use Clerk's **LinkedIn OIDC** social connection.

Expected LinkedIn use:

- Confirm the user is a real professional.
- Pull basic identity fields such as name, email, photo, and headline when available.
- Store the LinkedIn provider user ID for account linking.
- Use the profile URL or headline as professional context.

Do not depend on LinkedIn for the network graph. LinkedIn connections are restricted and partner-gated, so they should not be core to Kinfolk's growth loop.

## Database

Use **Supabase Postgres** as the primary database.

Why:

- SQL is a good fit for users, contacts, referrals, invitations, messages, and audit trails.
- Supabase Realtime can power live onboarding and messaging status.
- Row Level Security gives us a clear security model as the product grows.
- Supabase Storage can handle uploaded files later if needed.

Use direct server-side Supabase access for privileged operations. Use browser Supabase only for carefully scoped realtime subscriptions and public-safe reads.

## Realtime

Use **Supabase Realtime** for product state that should update immediately:

- Phone verification completed.
- New inbound message received.
- Contact import completed.
- Matching interview started, paused, resumed, or completed.
- Structured preference profile extracted or updated.
- Apartment or roommate match status changed.
- Match preparation checklist updated.
- Referral/invite status changed.
- Agent or workflow status changed.

The user should not need to refresh after sending a verification text or importing contacts.

## Messaging And Phone Verification

Use **Twilio** for SMS and phone-number capture.

Flow:

1. Generate a short verification code for the signed-in user.
2. Show a "Continue on phone" CTA.
3. Open the user's native SMS composer with a prefilled message containing the code.
4. Receive the inbound Twilio webhook.
5. Parse the code and sender number.
6. Attach the phone number to the Kinfolk user.
7. Update the UI through Supabase Realtime.

Use **WhatsApp** as a second channel where it matters. We can either use Twilio WhatsApp or the Meta WhatsApp Business Platform, depending on pricing, approval, and implementation speed.

For Apple users, start with `sms:` deep links that open Messages. Treat this as a user-side messaging handoff, not as guaranteed iMessage business infrastructure.

## Contact Import

Use a progressive contact strategy.

Primary options:

- Browser Contact Picker API where supported.
- Google Contacts OAuth.
- Microsoft Graph contacts OAuth.
- CSV or vCard upload.
- Manual invite/referral links.

The Contact Picker API is useful but limited. It mainly works in Chrome/Chromium on Android and requires the user to manually select contacts each time. It should be treated as a high-conversion enhancement, not the only import path.

Contact import principles:

- Ask after trust is established.
- Explain exactly why contacts help.
- Let users choose what to share.
- Store normalized/hardened contact records.
- Avoid exposing raw imported contact data broadly.
- Use hashes for matching where possible.

## Conversational Interview And Matching

Use a Standout-inspired interview flow to turn subjective housing preferences into structured matching data.

Research notes:

- Standout starts with LinkedIn identity and then uses an agent-led conversation to represent the person.
- Standout's public positioning is agentic matching: each side gets an autonomous agent that vets the other side and only makes an introduction when fit is real.
- The live Standout app pairs the call with a structured profile, anonymous-by-default visibility, a matches queue, and post-match preparation actions.
- Standout's public client bundle appears to use **Retell Web Client** over **LiveKit** for the browser call path: the loaded chunks reference `RetellWebClient`, Retell call lifecycle events, `/api/me/call`, `/api/me/phone-call`, and a `retell-ai` LiveKit websocket host. Treat this as implementation evidence from public frontend assets, not a formal vendor confirmation.
- The product lesson for Kinfolk is to make onboarding feel like "talk to a person who understands me," not "fill out a long housing form."

Kinfolk interview flow:

1. Confirm identity with LinkedIn or email.
2. Verify phone number before any externally visible matching action.
3. Capture a lightweight baseline matching profile before the call: budget range, target neighborhoods, move-in timing, household size, pets, and must-haves.
4. Offer "Talk to Kinfolk" as an optional voice-first interview, with a text fallback.
5. Ask focused questions about apartment needs, roommate preferences, lifestyle, constraints, and dealbreakers.
6. Save both a transcript and a structured preference profile.
7. Show the user a review screen before the profile affects matches or introductions.
8. Let the user edit, delete, or rerun the interview.
9. Maintain a match queue where users can approve, pass, or prepare for the next step.

Recommended implementation:

- If we want the closest Standout-like implementation path, start by evaluating **Retell AI web calls** backed by LiveKit-style browser audio sessions.
- If we want to own more of the voice stack, evaluate **OpenAI Realtime API + Agents SDK for TypeScript** for browser-based speech-to-speech interviews inside the Next.js app.
- In either path, mint short-lived call/session credentials from a server route. Never expose long-lived vendor API keys to the client.
- Store interview sessions, transcripts, extracted preferences, confidence scores, and consent state in Supabase Postgres.
- Use Supabase Realtime to update the UI when the interview completes and when extracted preferences are ready.
- Use background jobs for slower transcript cleanup, structured extraction, scoring, and match recomputation.
- Compare **Retell AI**, **OpenAI Realtime**, and **Vapi** on hosted phone-call support, browser latency, transcript quality, structured extraction hooks, analytics, compliance controls, and total operational lift.

Data model concepts:

- `matching_profiles`: user, profile status, target markets, budget, move-in window, household intent, visibility mode, profile completeness.
- `matching_interviews`: user, status, channel, started/completed timestamps, consent flags, transcript pointer, summary.
- `housing_preferences`: budget, locations, move-in date, lease duration, commute constraints, pets, smoking, guests, remote-work needs, accessibility needs, dealbreakers.
- `roommate_preferences`: lifestyle, cleanliness, schedule, noise tolerance, social energy, sharing expectations, conflict style, compatibility notes.
- `match_evidence`: why a match was suggested, which preferences matched, which tradeoffs or risks should be shown to the user.
- `match_queue_items`: candidate apartment or roommate, status, intro approval state, last action, expiry, next step.
- `interaction_summaries`: short summaries of interviews, match reviews, and follow-up conversations.
- `match_preparation_tasks`: suggested questions, tour checklist items, roommate conversation prompts, and documents needed before an intro or viewing.

Interview principles:

- Keep the first interview short, ideally 3-5 minutes.
- Ask adaptive follow-ups only when they change match quality.
- Prefer structured extraction over treating the transcript as the matching source of truth.
- Do not make introductions automatically. Ask both sides to approve before revealing identity or contact details.
- Treat sensitive lifestyle and housing data as private matching context, not public profile content.
- Default to anonymous or limited visibility while the user is exploring.
- Every suggested match should come with evidence and a next action, not just a score.

## Email

Use **Resend** or **Postmark** for transactional email. (NOTE: DO WE NEED RESEND SES)

Use email for:

- Account notifications
- Invite delivery
- Magic links if Clerk email auth needs app-specific styling
- Referral reminders
- Product lifecycle messages

Do not use email as the only growth channel. It should support the phone/contact loop.

## Analytics

Use **PostHog** for product analytics.

Track the core funnel:

- Viewed onboarding
- Started LinkedIn auth
- Completed LinkedIn auth
- Started phone handoff
- Completed phone verification
- Opened contact import
- Imported contacts
- Sent first invite
- Accepted invite
- Started matching interview
- Completed matching interview
- Reviewed extracted preferences
- Entered match queue
- Approved apartment or roommate match
- Rejected apartment or roommate match
- Prepared for apartment tour or roommate intro
- Accepted introduction

Use **Sentry** for application errors.

Use Render logs and Supabase logs for infrastructure debugging.

## AI And Agent Layer

Keep the AI layer separate from auth and contacts.

Potential responsibilities:

- Explain who to invite.
- Suggest warm introductions.
- Rank imported contacts.
- Conduct apartment and roommate matching interviews.
- Extract structured preferences from interview transcripts.
- Explain why a roommate or apartment match might fit.
- Surface missing information that would improve matching.
- Generate next-step preparation prompts after a match is accepted.
- Draft referral messages.
- Summarize a user's network.
- Power a conversational onboarding assistant.

Recommended starting point:

- OpenAI API for general reasoning, structured extraction, and realtime interview conversations.
- Background jobs for slow enrichment or ranking tasks.
- Strict audit logs for AI-generated outreach or recommendations.

## File And Media Handling

Use Supabase Storage or S3-compatible storage if the product needs:

- Profile uploads
- Resume uploads
- CSV/vCard contact imports
- Attachments in messaging

Keep uploads server-mediated so we can enforce file type, size, ownership, and retention rules.

## Security And Privacy

This product will handle sensitive social graph data, so privacy needs to be part of the stack from the start.

Requirements:

- Explicit consent before importing contacts.
- Explicit consent before recording, transcribing, or analyzing matching interviews.
- Separate consent scopes for LinkedIn, phone, email, and contacts.
- Separate consent scopes for interview transcript storage, structured preference extraction, and using those preferences for matching.
- Clear delete/export path for user data.
- RLS on user-owned data.
- Webhook signature verification.
- Rate limits on invites and messaging.
- Contact matching with hashed phone/email values where practical.
- Housing and roommate preferences should default to private matching context, not public profile fields.
- Introductions should require approval from both sides before contact details or identity-sensitive context are revealed.
- No silent contact scraping.
- No LinkedIn connection scraping.

## Initial Build Order

1. Next.js app shell.
2. Clerk auth with LinkedIn OIDC.
3. User upsert from Clerk webhook.
4. Supabase schema and RLS.
5. Phone verification through Twilio inbound SMS.
6. Realtime verification status.
7. Baseline housing and roommate preference profile.
8. Basic conversational matching interview.
9. Structured preference extraction and review screen.
10. Basic apartment/roommate match scoring and queue.
11. Intro approval and match-preparation workflow.
12. Basic invite/referral link flow.
13. Contact import fallback stack.
14. Analytics and error reporting.
15. AI-assisted ranking and outreach.

## Open Decisions

- Whether to use Twilio WhatsApp or Meta's direct WhatsApp Business API.
- Whether Google Contacts or phone contacts should be the first contact import provider.
- Whether contact matching should store only hashes at launch or retain encrypted raw contact fields.
- Whether the app needs native mobile later, or if browser plus messaging is enough.
- Which parts of the graph should be user-visible versus only used for matching.
- Whether the first matching interview should be voice-first, text-first, or let the user choose.
- Whether to mirror Standout's apparent hosted Retell/LiveKit approach or own more of the voice layer with OpenAI Realtime.
- Whether interview transcripts should be retained by default, summarized and deleted, or retained only when the user opts in.
