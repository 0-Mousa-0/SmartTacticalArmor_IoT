# Supabase setup: the PostgreSQL database

The backend stores everything in PostgreSQL through SQLAlchemy: operators, personnel, vests, telemetry,
incidents, commands and the AI baselines. Supabase hosts that database on its free plan. This guide
takes about 10 minutes, and **you only need to do it once**.

> **What the project needs from you:** one connection string, the *Session pooler URI*. It goes into
> `backend/.env` for local runs and into Render's `DATABASE_URL` for production. Nothing else in
> Supabase has to be configured by hand: the backend's migrations create the tables and lock them down.

## 1. Create the project

1. Go to <https://supabase.com> → **Start your project**. Signing in with GitHub (`0-Mousa-0`) is easiest.
2. **New project**:

   | Field | Value |
   |---|---|
   | Organization | Your personal organization, **Free** plan |
   | Project name | `dera-sta` |
   | Database password | Click **Generate a password**, then **copy it into your password manager now**. Supabase does not show it again |
   | Region | **Central EU (Frankfurt)**: the same region as the Render API in `render.yaml` |

3. If the form asks how you will connect (**Data API + Connection string** or **Only Connection
   string**), choose **Only Connection string**. The backend talks to Postgres directly, so the public Data
   API is not needed. If you keep it, the backend's migration still enables row-level security on every
   table, which keeps them closed to the Data API.
4. Click **Create new project** and wait for it to finish provisioning (about 2 minutes).

> **Password tip:** use letters and digits only, or the generated password. Characters like `@ : / ? #`
> must be URL-encoded inside a connection string (`@` → `%40`), which is a common cause of
> "authentication failed".

## 2. Copy the connection string

1. In the project dashboard, click **Connect** in the top bar.
2. Choose **Connection string** → type **URI** → **Session pooler**.
3. Copy the URI. It looks like this:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-<n>-eu-central-1.pooler.supabase.com:5432/postgres
   ```

4. Replace `[YOUR-PASSWORD]`, including the brackets, with the database password from step 1.

**Why the Session pooler?** Render's servers reach the internet over IPv4 only. Supabase's *direct*
connection (`db.<ref>.supabase.co`) uses IPv6 unless you buy the IPv4 add-on. The Session pooler on port
**5432** works over IPv4, keeps normal Postgres sessions (which migrations need), and is free. Do not use the
Transaction pooler (port 6543) for this backend.

You do **not** need to add `?sslmode=require`. The backend adds it automatically for any non-local
database.

## 3. Use it locally and create the tables

From the repository root, in PowerShell (Windows):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env
```

Open `backend/.env` and set:

```ini
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-<n>-eu-central-1.pooler.supabase.com:5432/postgres
SECRET_KEY=<run: python -c "import secrets; print(secrets.token_urlsafe(48))">
```

Then create the schema and the demo data:

```powershell
flask --app wsgi db upgrade        # creates all tables, then enables row-level security
flask --app wsgi seed-demo         # vests STA-01..06 and wearers ALPHA-01..06 (idempotent)
flask --app wsgi create-operator you@example.com --name "Duty Admin" --role admin
```

`create-operator` asks for the password twice. Use `--real-only` with `seed-demo` if you do not want the
five simulated vests.

Expected output of `db upgrade`:

```
INFO  [alembic.runtime.migration] Running upgrade  -> 0001_initial, initial schema
INFO  [alembic.runtime.migration] Running upgrade 0001_initial -> 0002_enable_rls, enable row level security on every table (Supabase hardening)
```

## 4. Check it in Supabase

* **Table Editor** shows `operators`, `personnel`, `devices`, `telemetry_readings`, `alerts`,
  `alert_events`, `commands`, `metric_baselines` and `alembic_version`. Each one is marked **RLS enabled**.
* **Advisors → Security Advisor** shows no "RLS disabled in public" errors.

The tables have RLS on and **no policies**. The public Data API therefore cannot read or write them. The
backend connects as the database owner (`postgres`), which is not affected by RLS.

## 5. Give it to production

In Render, paste the same URI into the API service's `DATABASE_URL` (see
[Render deployment](08-deploy-render.md)). The API applies new migrations automatically every time it
starts, so you never run `db upgrade` against production by hand.

## 6. Good to know

| Topic | Detail |
|---|---|
| Free plan limits | 500 MB database. The system stores at most one telemetry sample per vest every 5 s and purges history older than `TELEMETRY_RETENTION_DAYS` (7) |
| Pausing | Supabase can pause free projects after about a week with no activity. A connected vest or a visit to the dashboard counts as activity. If it was paused, open the project and click **Restore** |
| Backups | The free plan has no point-in-time recovery. For a copy: `pg_dump "<session pooler URI>" > backup.sql` |
| Changing the password | **Project Settings → Database → Reset database password**, then update `backend/.env` and Render |
| Keep it secret | The URI contains the password. It lives only in the git-ignored `.env` and in Render. Never commit it or post it in an issue |

## 7. Troubleshooting

| Message | Cause and fix |
|---|---|
| `password authentication failed` | Wrong password, or special characters that are not URL-encoded. Reset the password (step 6) and use letters and digits |
| `Tenant or user not found` | The user name must be `postgres.<project-ref>` for the pooler, not plain `postgres` |
| `Network is unreachable` / `could not translate host name` with `db.<ref>.supabase.co` | You copied the *direct* connection. Use the **Session pooler** URI |
| `DATABASE_URL is not set: refusing to run production on a throwaway SQLite file` | `FLASK_ENV` is not `development` and no `DATABASE_URL` was found. Set it in `.env` or Render |
| Timeouts after a long idle period | The project was paused. Restore it in the Supabase dashboard |
