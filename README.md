# RepTracker

A workout logger built for the phone you are holding between sets, with a stats dashboard meant
for a real screen afterwards.

- **In the gym** — start from a saved routine or an empty session, log weight and reps a tap at a
  time, see what you lifted last time on the same row, and get a rest timer that keeps counting
  while the screen is off.
- **At a desk** — weekly volume, hard sets per muscle group against an evidence-based target band,
  a consistency heatmap, estimated 1RM per exercise over time, personal records, and a nudge when
  a lift has stopped moving.

---

## Stack

| Part | Choice |
|---|---|
| API | ASP.NET Core 10 minimal APIs |
| Database | PostgreSQL via EF Core 10 (Npgsql) |
| Frontend | React 19 + TypeScript + Vite, TanStack Query, Recharts |
| Deploy | One Docker image serving both the API and the SPA |

```
src/
  RepTracker.Api/     API, EF Core model, statistics, and wwwroot (the built SPA lands here)
  web/                React app
Dockerfile            node build -> dotnet publish -> runtime
docker-compose.yml    Postgres for local development
```

There is deliberately no separate frontend host. The API serves `/api/*` and falls through to the
SPA for everything else, which means one deployable, one origin, no CORS, and a plain same-site
session cookie.

---

## Running it locally

```bash
docker compose up -d db                       # Postgres on :5432

cd src/RepTracker.Api && dotnet run            # API on :5199, migrates and seeds on boot
cd src/web && npm install && npm run dev       # Vite on :5173, proxying /api to :5199
```

Open <http://localhost:5173> and create an account.

To browse a populated dashboard instead of an empty one:

```bash
cd src/RepTracker.Api
dotnet run -- seed-demo      # prints a login code for an account with ~20 weeks of training
```

`seed-demo` refuses to run outside Development — it backdates rows, which nothing reachable over
HTTP can do.

### Building the SPA into the API

`npm run build` writes to `src/RepTracker.Api/wwwroot`, so `dotnet run` then serves the real thing
on `:5199` without Vite. That directory is generated and is not in version control.

---

## Accounts

There is no email and no password. Signing up mints **20 digits** — 19 random plus a Luhn check
digit — and that is the whole credential:

```
4821 9930 1174 5528
```

- Stored as `HMAC-SHA256(code, App__LoginPepper)`, indexed, so login is one lookup. A stolen
  database is useless without the pepper, which lives in the environment rather than in Postgres.
- The check digit is verified in the browser, so a mistyped code never becomes a request.
- **It cannot be recovered.** Not by the user, not by you. Losing it loses the account.

Sessions are opaque random tokens in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, stored as
SHA-256 hashes in a `Sessions` table so they can actually be revoked.

---

## Keeping the bill down

This is designed to be hosted on someone's own money, so every endpoint is bounded.

| Vector | Control | Setting |
|---|---|---|
| Guessing a login code | 8 attempts / IP / 15 min, over a 2⁶³ keyspace | — |
| Sign-up spam filling the database | 3 / IP / hour, plus a hard account ceiling | `App__MaxAccounts` |
| Unwanted sign-ups at all | Optional shared invite code | `App__SignupCode` |
| A logged-in account flooding rows | Per-user caps on workouts, sets, routines, exercises | `App__Limits__*` |
| General API hammering | 240 req/min per account, 60/min per anonymous IP | — |
| Oversized payloads | 64 KB request body, 16 KB headers, 200 connections | — |
| Expensive reads | Page sizes clamped; stats bounded by an explicit week window | — |
| Forged client IPs defeating the above | `X-Forwarded-For` honoured only when explicitly enabled | `App__TrustProxyHeaders` |
| Bandwidth | Hashed assets served `immutable`; the SPA shell is `no-cache` | — |

Rate limit state is in-process. That is the right call for one small instance and the wrong one if
you ever run two — at that point the limiter needs a shared store.

> `App__TrustProxyHeaders=true` tells the app to believe `X-Forwarded-For`. Only set it when the
> container is genuinely unreachable except through your platform's proxy. If the port is exposed
> directly, anyone can forge a header and hand themselves a fresh rate-limit budget.

---

## Configuration

Every setting binds from the `App` section, so each is an environment variable:

| Variable | Default | What it does |
|---|---|---|
| `ConnectionStrings__Postgres` | — | Connection string. `DATABASE_URL` (a `postgres://` URL) is accepted instead. |
| `App__LoginPepper` | — | **Required in production.** Key the login codes are HMAC'd under. |
| `App__SignupCode` | unset | When set, registration requires it. |
| `App__MaxAccounts` | `50` | Hard ceiling on accounts. |
| `App__SessionDays` | `60` | Session lifetime. |
| `App__TrustProxyHeaders` | `false` | Read the client IP from `X-Forwarded-For`. |
| `App__Limits__Workouts` | `2000` | Stored workouts per account. |
| `App__Limits__SetsPerExercise` | `40` | Sets per exercise in one workout. |
| `App__Limits__ExercisesPerWorkout` | `40` | |
| `App__Limits__CustomExercises` | `300` | |
| `App__Limits__Routines` | `60` | |

**Changing `App__LoginPepper` invalidates every existing login code.** There is no way back — the
plaintext codes were never stored. Generate it once and keep it:

```bash
openssl rand -base64 32
```

The app refuses to start in Production without it, rather than silently locking everyone out.

---

## Deploying

```bash
docker build -t reptracker .
docker run -p 8080:8080 \
  -e ConnectionStrings__Postgres="Host=...;Database=reptracker;Username=...;Password=..." \
  -e App__LoginPepper="$(openssl rand -base64 32)" \
  -e App__TrustProxyHeaders=true \
  -e App__SignupCode="whatever-you-tell-your-friends" \
  reptracker
```

The image listens on `8080`, runs as a non-root user, and exposes `/api/health` for the platform's
health check. Migrations run at startup, so a deploy needs no separate step.

Anywhere that runs a container and a Postgres works — Fly.io, Railway, Render, or a VPS with
Caddy in front. Back up the database; nothing else in the image is stateful.

---

## How the numbers are worked out

Worth knowing, because the charts are only useful if you trust them.

- **Everything is stored in kilograms.** kg/lb is a display conversion, so switching units never
  rewrites or fragments your history.
- **Volume** is `load × reps`, over completed working sets only. Warm-ups never count, anywhere.
- **Bodyweight movements** use your bodyweight plus any added load, so pull-ups are not recorded as
  zero. Set your bodyweight in Settings or they stay at zero.
- **Estimated 1RM** is Epley (`w × (1 + reps/30)`), taken from the best working set of a session,
  and **ignored above 12 reps** — past there the formula stops tracking strength.
- **Personal records** are recomputed by replaying your history in order, so editing or deleting a
  set corrects the record feed instead of leaving a phantom PR behind.
- **Hard sets per muscle group** counts completed working sets of loaded movements. The shaded band
  is 10–20 sets per week.
- **Stalled** means an exercise you are still training whose best estimated 1RM has not improved in
  6+ weeks across at least 3 sessions.
- **Weeks start on Monday**, bucketed in your browser's timezone rather than the server's.

## Colour

The chart palette is not eyeballed. The two-slot categorical pair and the four-step sequential ramp
were run through a contrast and colour-vision validator against this app's own light and dark
surfaces, and clear the lightness band, chroma floor, CVD separation and contrast checks in both.
The tokens live in `src/web/src/styles/viz.css`; charts reference roles, never raw hex.
