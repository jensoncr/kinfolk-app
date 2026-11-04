# Operations

Runbook for keeping the Kinfolk iMessage agent healthy in production (Render).

## Web service build & start (Render dashboard)

The repo is a pnpm monorepo (`apps/web` + `packages/pipeline`); the Render web
service is configured in the dashboard, not from a `render.yaml`. The service
must use the root proxy scripts:

- **Build command:** `corepack enable && pnpm install --frozen-lockfile && pnpm build`
- **Start command:** `pnpm start`

Root `package.json` proxies both into `apps/web` (`pnpm -C apps/web …`), and
`packageManager: pnpm@11.6.0` pins the version corepack activates. Node must
satisfy `engines.node >= 22.13.0`. If a deploy fails right after a repo
restructure, check these two commands first — Render keeps serving the last
good build, so the site staying up does not mean the latest commit deployed.

The build step also needs every `NEXT_PUBLIC_*` var set on the service — Next
inlines them into the client bundle at build time, so a missing or wrong value
ships silently (the build still goes green; e.g. without
`NEXT_PUBLIC_MAPBOX_TOKEN` the `/apartments` map renders its missing-token
panel to real users). ci.yml's three build vars are the minimum to compile,
not the production set — the full list lives in the "Production env checklist"
table below. The build also uses devDependencies (tailwindcss, typescript);
pnpm ≥ v10 installs them even when `NODE_ENV=production` (this repo pins
11.6.0), so no extra install flags are needed.

## Text agent queue drain (Render cron)

Inbound texts queue a `text_agent_runs` row, and the Sendblue webhook drains it
with Next's `after()` hook. If that hook dies (deploy, crash, timeout), the run
sits queued forever and the user never gets a reply. `POST /api/jobs/text-agent`
is the rescue: it requeues stale running runs, claims and processes queued runs
(including ones the webhook never picked up), and texts the founder if a backlog
builds. Run it every minute.

### Render dashboard steps

1. Render dashboard → **New +** → **Cron Job**.
2. Pick the same repo/team as the Kinfolk web service (the cron job only needs
   `curl`, so the cheapest instance type is fine; runtime: Docker or any image
   with curl, e.g. environment `Node` works).
3. **Schedule:** `* * * * *` (every minute).
4. **Command:**

   ```sh
   curl -fsS -X POST -H "Authorization: Bearer $KINFOLK_JOBS_SECRET" https://<your-web-service>.onrender.com/api/jobs/text-agent
   ```

   Replace `<your-web-service>` with the web service's host (or use the
   `usekinfolk.com` domain once it points at Render).
5. **Environment → Add Environment Variable:** `KINFOLK_JOBS_SECRET`, set to the
   exact same value as on the web service. (Job auth fails closed: if the web
   service is missing this var, every `/api/jobs/*` call 500s.)
6. Create the cron job, then click **Trigger Run** once and confirm the run log
   shows a JSON body like `{"ok":true,"claimed":0,...,"staleQueued":0}`.

The job response fields: `claimed`/`completed`/`failed`/`skipped` describe this
sweep; `staleQueued` is how many eligible runs had been sitting queued for over
60 seconds when the sweep started — persistently nonzero means webhook drainage
is failing upstream.

## Silent matcher sweep (Render cron)

`POST /api/jobs/silent-matcher` scans living plans that opted into Quiet watch
on `/me/plan` and precomputes compatibility edges for city-and-timing-matched
pairs. It is candidates-only: nothing is revealed or sent to any user (reveal
is blocked on the consent questions documented in
`lib/matching/silent-matcher.ts`). Plans change slowly — daily is plenty.

Create a Render cron job like the queue drain above, schedule `30 9 * * *`
(daily), command:

```sh
curl -fsS -X POST -H "Authorization: Bearer $KINFOLK_JOBS_SECRET" https://<your-web-service>.onrender.com/api/jobs/silent-matcher
```

A successful run logs counts only, e.g.
`{"scannedUsers":4,"pairsConsidered":2,"candidatesWritten":2}`.

## Profile compatibility queue backstop (Render cron)

Profile updates enqueue durable compatibility refresh work. The normal request
path may drain it immediately, but a deploy, timeout, or process restart can
leave queued work behind. Run the queue-only job every 1-5 minutes so those
refreshes are eventually applied without rescanning unrelated users.

Create a Render cron job with a schedule such as `*/2 * * * *` and command:

```sh
curl -fsS -X POST -H "Authorization: Bearer $KINFOLK_JOBS_SECRET" -H "Content-Type: application/json" --data '{"queuedOnly":true,"limit":50}' https://<your-web-service>.onrender.com/api/jobs/profile-compatibility
```

Use the same `KINFOLK_JOBS_SECRET` as the web service. A successful run should
return a JSON summary of claimed/processed queue work; repeated failures or a
persistently full batch indicate the durable queue is falling behind.

## Proactive notification sweep (Render cron)

`POST /api/jobs/proactivity` scans explicitly opted-in notification cohorts.
It reuses verified-phone consent, transport availability, quiet hours, daily
caps, and delivery idempotency. Optional profile questions are additionally
limited to one every seven days and one unresolved question at a time.

Create a Render cron job with a schedule such as `*/5 * * * *` and command:

```sh
curl -fsS -X POST -H "Authorization: Bearer $KINFOLK_JOBS_SECRET" -H "Content-Type: application/json" --data '{}' https://<your-web-service>.onrender.com/api/jobs/proactivity
```

## Founder failure alerts

Agent failure paths (webhook processing, queued-run processing, the live-loop
outage bubble, outbound transport sends, the jobs route) now text the founder
directly via the active text transport instead of failing silently.

- **Env var:** set `KINFOLK_FOUNDER_ALERT_PHONE` on the **web service** (prod)
  to the founder's E.164 number, e.g. `+1415XXXXXXX`. Unset = alerts only go to
  the Render logs as structured `[founder-alert]` lines.
- **Throttle:** max one text per alert reason per 30 minutes (tracked in
  `text_agent_rate_limits`, bucket type `founder_alert_reason_30m`), so an
  outage storm costs a handful of texts, not hundreds. Every occurrence still
  logs.
- **Alert reasons:** `text_webhook_processing_failed`, `text_agent_run_failed`,
  `text_agent_queue_backlog`, `text_agent_job_failed`, `text_reply_send_failed`,
  `housing_agent_unavailable:<reason>`.
- Alerts are best-effort and never recurse: a failure inside the alert path is
  logged (`[founder-alert] alert delivery failed`) and dropped.

## Production env checklist for this runbook

| Var | Where | Why |
| --- | --- | --- |
| `KINFOLK_JOBS_SECRET` | web service + cron job | authorizes `/api/jobs/*`; fails closed when unset |
| `KINFOLK_FOUNDER_ALERT_PHONE` | web service | where failure alert texts go |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web service (build-time, inlined) | Clerk client SDK |
| `NEXT_PUBLIC_SUPABASE_URL` | web service (build-time, inlined) | Supabase client |
| `NEXT_PUBLIC_KINFOLK_BASE_URL` | web service (build-time, inlined) | canonical origin for client links |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | web service (build-time, inlined) | `/apartments` map; missing → user-facing missing-token panel |
| `NEXT_PUBLIC_CLERK_PROXY_URL` | web service (build-time, inlined) | Clerk proxy (`apps/web/proxy.ts`); unused until the Clerk production-instance migration lands |
