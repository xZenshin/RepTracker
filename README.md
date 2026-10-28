# RepTracker

A workout logger built for the phone you are holding between sets, with a stats dashboard meant
for a real screen afterwards.

- **In the gym** — start from a saved routine or an empty session, log weight and reps a tap at a
  time, see what you lifted last time on the same row, and get a rest timer that keeps counting
  while the screen is off. The workout stays on the phone until you finish it, so a tap never
  waits on gym signal.
- **At a desk** — weekly volume, hard sets per muscle group, a consistency heatmap, estimated 1RM
  per exercise over time, personal records, and a nudge when a lift has stopped moving.

It is an ASP.NET Core API and a React app, shipped as one Docker image backed by PostgreSQL.

**Live at <https://reptracker-9fku.onrender.com>**, hosted on Render. Will probably be moved somewhere else, since the Render free tier DB only lasts for a month :skull:.

---

## No account details

There is no email, no password and no profile to fill in. Signing up hands you a 20-digit code,
and that code is the only way in:

```
4821 9930 1174 5528 0362
```

Write it down. **It cannot be recovered** — lose the code and you lose the account.

---

## Running it locally

```bash
docker compose up -d db                       # Postgres on :5432

cd src/RepTracker.Api && dotnet run            # API on :5199, migrates and seeds on boot
cd src/web && npm install && npm run dev       # Vite on :5173, proxying /api to :5199
```

Open <http://localhost:5173> and sign up.

To browse a populated dashboard instead of an empty one:

```bash
cd src/RepTracker.Api
dotnet run -- seed-demo      # prints a login code for an account with ~20 weeks of training
```

`seed-demo` only runs in Development.

---

How it is built, its traps, and what is deliberately missing are in [HANDOFF.md](HANDOFF.md).
