# ReachInbox Scheduler

A production-grade email job scheduler + dashboard: schedule thousands of emails, get them sent
at the right time with per-sender rate limiting, and have the whole thing survive a server
restart without losing or duplicating a single send.

## Setup

### Prerequisites

- Docker + Docker Compose
- A Google OAuth Client ID/Secret ([console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)) with authorized redirect URI `http://localhost:3000/api/auth/callback/google`

### Run everything with Docker Compose

```bash
cp .env.example .env
# edit .env: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and NEXTAUTH_SECRET
# (generate a secret with: openssl rand -base64 32)

docker compose up --build
```

This starts, in order: Postgres → Redis → a one-off `migrate` service that applies the schema →
`backend-api` (port 4000), `backend-worker`, and `frontend` (port 3000).

Then seed a sender so the Compose modal has something to send from:

```bash
docker compose exec backend-api npm run db:seed
```

If `ETHEREAL_USER`/`ETHEREAL_PASS` aren't set in `.env`, this provisions a fresh Ethereal test
account and prints its credentials - copy them into `.env` and re-run `docker compose up -d
backend-api backend-worker` to reuse the same inbox next time (otherwise every worker restart
would send into a different throwaway inbox). Visit http://localhost:3000, sign in with Google,
and compose a campaign. Sent messages can be viewed at the `previewUrl` logged by the worker
(Ethereal never actually delivers mail - it's a fake SMTP catch-all built for exactly this).

### Run without Docker (for local development)

```bash
# Terminal 1 - Postgres & Redis only
docker compose up postgres redis

# Terminal 2 - backend
cd backend
cp .env.example .env   # fill in NEXTAUTH_SECRET to match the frontend
npm install
npm run db:migrate
npm run db:seed
npm run dev             # API on :4000

# Terminal 3 - worker
cd backend
npm run dev:worker

# Terminal 4 - frontend
cd frontend
cp .env.local.example .env.local  # fill in Google + NEXTAUTH_SECRET (must match backend)
npm install
npm run dev              # UI on :3000
```

### Tests

```bash
cd backend
npm test                 # pure-logic unit tests (scheduler, rate limiter) - no infra needed
npm run test:integration # needs Postgres + Redis running (docker compose up postgres redis)
npm run test:all         # both
```

---

## Architecture

**PostgreSQL is the source of truth. Redis/BullMQ is only the trigger mechanism.** Every
`email_jobs` row's real status lives in Postgres. BullMQ's only job is to wake a worker up at
roughly the right time by firing a delayed job. If Redis were wiped entirely, nothing about *what
happened* to any email would be lost - only the "alarm clocks" would need to be rebuilt, which is
exactly what the startup reconciliation pass does.

```
Browser (Next.js)                Express API                BullMQ Worker (separate process)
  CSV -> PapaParse                validate (zod)               claim (Postgres)
  POST /api/campaigns  ────────►  compute schedule    ────►    rate-limit check (Redis)
                                  insert campaign+jobs          send (Ethereal SMTP)
                                  enqueue BullMQ jobs           mark sent/failed (Postgres)
                                        │
                                        ▼
                                   PostgreSQL (source of truth)
                                        ▲
                                        │
                              Reconciliation (on API startup)
```

The API and the worker are **separate processes** (`src/index.ts` vs `src/worker.ts`, run as
`backend-api` and `backend-worker` in docker-compose) so the worker can be scaled independently
of request-handling capacity - `docker compose up --scale backend-worker=3` works out of the box
because all the coordination (rate limits, claims) is done through Postgres/Redis, not process
memory.

---

## Scheduling (proactive)

When a campaign is created, the backend computes **every** recipient's `scheduled_time` up front,
deterministically, before anything touches the queue (`services/scheduleSimulator.ts`):

- Recipient *i* is scheduled at `previous send time + delayBetweenEmailsMs` (recipient 0 uses
  `startTime`).
- If that would push the count of sends in that clock-hour above `hourlyLimit`, the recipient
  instead rolls forward to the start of the next hour window.

Because each recipient's time is only ever derived from the one before it, times are
non-decreasing by construction - **order is preserved automatically**, and the frontend gets
back accurate `scheduled_time` values immediately in the API response, without waiting for a
worker to run anything. All of this is one pure function with no I/O, so it's fully unit-tested
(13 cases: ordering, spacing, rollover, exact-hour boundaries, a 1200-recipient batch, etc.) in
`scheduleSimulator.test.ts`.

## Reactive rate limiting (why the worker re-checks anyway)

Proactive scheduling gets one campaign's own recipients correctly spaced relative to each other.
It does **not** know about a *different* campaign that also uses the same sender and might
schedule into the same hour window. So immediately before actually sending (and only after
successfully claiming the row - see Idempotency below), the worker re-checks the sender's hourly
counter in Redis:

- **Allowed** -> send.
- **Rejected** -> the email is never dropped or marked failed. The row goes back to `scheduled`
  with `scheduled_time` set to the start of the next hour window, a new BullMQ delayed job is
  added for that time, and the current job execution completes as a no-op.

This two-layer design (proactive for the common case, reactive as a correctness backstop) is
explained more in `services/rateLimiter.ts` and `queue/jobs/sendEmail.ts`.

### How the limits are actually enforced

| Requirement | Mechanism |
|---|---|
| Min delay between sends | BullMQ `Worker` limiter (`{ max: 1, duration: MIN_DELAY_MS }`) - global across the whole queue |
| Emails/hour, per sender | Redis, atomic Lua "check-and-increment" script, key `rl:{senderId}:{YYYYMMDDHH}` |
| Worker concurrency | `Worker({ concurrency: WORKER_CONCURRENCY })`, safe to run multiple worker processes |

The Lua script (`checkAndIncrementHourlyLimit`) checks the counter against the limit **and**
increments it in the same atomic Redis operation - this is what makes it safe across any number
of concurrent worker processes (verified in `rateLimiter.test.ts` with 100 concurrent attempts
against a limit of 20 - exactly 20 succeed, every time, regardless of interleaving). It also only
increments when there's room, so a request that was going to be rejected never wastes a slot.

**Avoiding a wasted rate-limit slot when a claim is lost:** the ordering in
`jobs/sendEmail.ts` is deliberately claim-first, rate-limit-check-second. A job that loses the
Postgres claim race (see Idempotency) returns immediately and never reaches the Redis script at
all - so it can never consume an hourly slot for an email someone else is about to send. If a
claimed job *does* pass the rate check but then fails at the actual SMTP call, the consumed slot
is explicitly given back (`releaseHourlyLimitSlot`) so a transient SMTP hiccup doesn't
permanently cost the sender real send capacity.

**Trade-off:** hourly windows are fixed UTC clock-hours (`10:00-10:59`), not a sliding 60-minute
window. This is simpler and gives predictable, human-readable reset times, at the cost of allowing
a short burst right around the boundary (e.g. a full hour's worth of sends at 10:59 followed by
another full hour's worth at 11:00). For a scheduler operating on hour-granularity limits, this
was judged an acceptable trade for the added complexity of a sliding window.

## Idempotency / duplicate-send protection

Two independent layers, doing two different jobs:

1. **BullMQ jobId = `email_jobs.id`** (for a row's initial schedule) prevents a second *delayed
   job* from ever being created for the same row - `queue.add()` with an existing jobId is a
   no-op. This is what makes re-running the enqueue step after a campaign create (e.g. an API
   request retry) safe.
2. **The Postgres atomic claim is what actually prevents a duplicate send:**
   ```sql
   UPDATE email_jobs SET status = 'processing'
   WHERE id = $1 AND status = 'scheduled'
   RETURNING id;
   ```
   BullMQ guarantees *at-least-once* delivery, not *exactly-once* - the same job can be delivered
   twice (a crash-and-retry, a stalled job that gets picked up again, reconciliation recreating a
   job that technically still existed). The jobId dedup does nothing to stop that. This one SQL
   statement does: Postgres guarantees only one caller ever gets a row back, no matter how many
   processes race to claim it at the same instant. Whoever doesn't get a row back does nothing and
   returns. Verified in `idempotency.integration.test.ts` with 25 concurrent claim attempts on the
   same row against a real Postgres instance - exactly one wins, every time.

### Why increment-then-claim would be wrong

The implementation is careful about ordering: **claim first, then rate-limit check.** If it were
reversed (check/increment the Redis counter, *then* try to claim the row), two workers racing for
the same row could both pass the rate-limit check and both increment the counter, even though
only one of them will actually win the claim and send. That would silently waste real hourly send
capacity on a job nobody ends up sending. Claiming first means only the actual winner ever reaches
the rate limiter.

### The one thing that genuinely cannot be guaranteed

There is a real, unavoidable failure window: **the SMTP server can accept the message, and then
the process can crash before the `UPDATE ... SET status = 'sent'` commits.** From Postgres's point
of view that row is still `processing`; reconciliation will eventually treat it as stale and
return it to `scheduled`, and the worker will genuinely send it again. No amount of application-level
logic closes this gap completely - true exactly-once delivery to an external system requires
either a two-phase commit the SMTP protocol doesn't support, or idempotency cooperation from the
receiving mail provider (e.g. a client-supplied message ID it de-duplicates on), which Ethereal
doesn't offer. What's implemented here is the strongest practical guarantee available without that
cooperation: the claim makes concurrent double-sends (the far more likely failure mode) essentially
impossible, and narrows the remaining risk to this one specific crash window, which is both rare
and, for a marketing/outreach email system, a tolerable failure mode compared to silently dropping
mail.

## Restart and recovery

- **Redis runs with `appendonly yes`** and a persistent Docker volume - delayed BullMQ jobs
  survive a Redis restart, not just an application restart.
- **Postgres also has a persistent volume**, so the source of truth survives regardless.
- **On every API server startup**, `services/reconciliation.ts` runs a repair pass:
  1. For every `email_jobs` row still `scheduled`, verify a live BullMQ job exists for it
     (`queue.getJob`). If not - Redis was flushed, an enqueue after a DB commit never completed,
     etc. - recreate the delayed job using the row's own `scheduled_time` (zero delay if it's
     already overdue).
  2. For every row stuck in `processing` with `updated_at` older than
     `PROCESSING_STALE_TIMEOUT_MS` (default 2 minutes) - almost certainly a worker that crashed
     mid-send - return it to `scheduled` with an immediate retry time and a fresh job.

Both paths are covered by real integration tests (`recovery.integration.test.ts`) that run
against genuine Postgres and Redis: one simulates Redis job loss by removing a live BullMQ job
and confirming reconciliation recreates it; the other inserts a row that's been `processing` for
10 minutes and confirms it's recovered back to `scheduled` with a working job.

`bullmq_job_id` on `email_jobs` (not in the original spec's column list, added per "add any
fields needed to make recovery safe") tracks which BullMQ job is currently responsible for a row.
It equals the row's own `id` for the initial schedule (satisfying the "email_jobs.id must be used
as the jobId" requirement for the primary case) and is set to a derived id
(`{rowId}-r{random}` / `{rowId}-recovery-{timestamp}`, using `-` rather than `:` since BullMQ
rejects colons in custom job ids) whenever the row is rescheduled after a rate-limit rejection or
stale-processing recovery. Reconciliation always checks the *current* `bullmq_job_id`, not
blindly `row.id`, so it works correctly across any number of reschedules.

## Concurrency

- `WORKER_CONCURRENCY` controls how many jobs one worker process handles in parallel
  (`Worker({ concurrency })`).
- Any number of `backend-worker` **processes** can run against the same queue -
  `docker compose up --scale backend-worker=N` requires no code changes, because every piece of
  shared state (rate limits, job claims) lives in Redis/Postgres, both of which provide the needed
  atomicity primitives, not in worker memory.
- The Postgres atomic claim and the Redis Lua script are the two places concurrency safety
  actually gets enforced; everything else in the worker is per-job, stateless logic.

---

## Data model

```
users         - one row per authenticated Google identity (never trust a client-supplied user_id;
                always derived from a verified JWT - see Authentication)
senders       - SMTP sender identities (Ethereal creds)
campaigns     - one row per "Compose" submission
email_jobs    - one row per recipient; status: scheduled | processing | sent | failed
```

Indexes: `email_jobs(campaign_id)` for campaign lookups, `email_jobs(status, scheduled_time)` for
the worker/reconciliation "what needs attention" queries, `email_jobs(status, updated_at)` for
stale-processing detection. All timestamps are `timestamptz`, stored and compared in UTC
throughout. A Postgres trigger (`0001_add_updated_at_trigger.sql`) sets `updated_at` on every
`email_jobs` update as a defense-in-depth backstop, since the stale-processing recovery path
depends on it being reliably fresh.

## Authentication

NextAuth keeps its own session cookie in the default format so the protected dashboard middleware
can read it consistently. The Express backend does not read that cookie directly; instead,
`frontend/lib/auth.ts` mints a short-lived (1h) HS256 token as `session.accessToken`, using the same
`NEXTAUTH_SECRET` the backend verifies with (`backend/src/auth/jwt.ts`). The frontend attaches that
token as `Authorization: Bearer <token>` on every API call.

On the backend, `middleware/auth.ts` verifies that token and **upserts the local `users` row from
the verified `sub`/`email`/`name`/`picture` claims on every request** - this is the only place a
`userId` is ever produced, and it never comes from anything in a request body. The campaign-create
payload has no `userId` field at all, so there's nothing for a client to spoof.

---

## Features implemented

**Backend:** delayed-job scheduler (BullMQ, no cron), Postgres persistence as source of truth,
proactive deterministic scheduling with hourly rollover, reactive per-sender rate limiting
(Redis atomic Lua), configurable worker concurrency, atomic idempotent claim, restart/reconciliation
recovery (missing jobs + stale processing), Zod-validated REST API, Google-JWT-authenticated and
user-scoped campaigns, Ethereal SMTP integration, structured logging (pino).

**Frontend:** real Google OAuth (NextAuth), protected dashboard route (middleware), header with
name/email/avatar/logout, Scheduled/Sent tabs with 7s polling, Compose modal (subject, body, CSV
upload with live recipient count via PapaParse, sender selector, start time, delay, hourly limit),
loading and empty states, client + server validation, reusable table/tabs/empty-state components.

**Tests:** 13 unit tests for the scheduler (ordering, delay, hourly rollover, exact-hour
boundaries, 1200-recipient batch), 7 unit tests for the rate limiter (including a 100-concurrent-
attempt atomicity check), and integration tests against real Postgres + Redis for idempotent
claiming, campaign creation + real BullMQ job creation, and both reconciliation paths - 27 tests
total, all passing.

## Assumptions, shortcuts, and trade-offs

- **Runs via `tsx` rather than a `tsc` build step in production.** `drizzle-kit`'s config loader
  doesn't cleanly resolve `NodeNext`-style explicit `.js` extensions in TypeScript source, so the
  project uses `moduleResolution: "bundler"` and runs `tsx` directly in both dev and the Docker
  image. `npm run typecheck` still fully type-checks the project with `tsc --noEmit`; this is a
  build-tooling choice, not a correctness gap, and is a common pattern for services of this size.
- **Senders are a flat, unauthenticated-per-sender table**, not scoped to a user/tenant - the
  brief describes "multiple senders" but not multi-tenant sender ownership, so any authenticated
  user can pick any configured sender. Rate limiting is correctly isolated per sender regardless.
- **No pagination UI** on the dashboard tables (the API supports `limit`/`offset`); with realistic
  campaign sizes for a take-home this wasn't worth the added UI complexity.
- **CSV parsing is entirely client-side** (PapaParse), and treats any cell matching an email regex
  as a recipient, deduplicated - no server-side re-validation of the *file*, though every
  individual address is still re-validated by the Zod schema server-side regardless of how it got
  there.
- **A campaign's email body is sent as-is as HTML** - no per-recipient templating/merge-fields,
  since the brief didn't ask for it.
#   R e a c h I n b o x _ P r o j e c t  
 