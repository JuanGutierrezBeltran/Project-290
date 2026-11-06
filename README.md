
# Early Builders / Developer Network dashboard

The program dashboard for Think4Ever's Early Builders / Developer Network. It runs as a Node.js service on Think and shows **real data only**. HubSpot, GA4 and PostHog are synced server-side into MySQL, and every screen is built from what was synced. When a source has no data, the dashboard shows 0 or `—`. It never shows a sample, an estimate or a simulated value.

Everything lives at the project root: `server.js`, `package.json`, `lib/`, `db/`, `public/` and `test/`.

## What the screens show

| Screen | Data | Source |
|--------|------|--------|
| Overview: close target | **Verified accounts** (`account_verified`, first per person, internal excluded) vs the 200 target | PostHog |
| Overview / Enrollment: funnel | Sessions → form submissions (HubSpot) · registration started → account created → account verified (PostHog) · form → verified account (person-level HMAC match) | HubSpot, PostHog, cross |
| Enrollment: invitation states | Invited, sent, delivered, replied, closed, accepted, enrolled (+ opened) per recipient | HubSpot marketing emails (`HUBSPOT_INVITE_EMAIL_IDS`) |
| Enrollment: channels | Sessions and contacts per traffic source | HubSpot |
| Builders, Day-14 activation, follow-ups | One row per verified person: pseudonymous code, email domain, projects, sign-ins, credits (when the event exists) and published content | PostHog + `builder_content` (recorded by hand) |
| Data sources | Connection state, last sync, missing variables | `data_sources`, updated by every sync |
| Header "Last sync" | End of the last successful sync | `sync_runs` |

Counting rules (in `lib/dashboard-repo.js`):

- **Sessions:** the sum of HubSpot `sessions` per traffic source, from `LAUNCH_DATE` to the last sync.
- **Form submissions:** HubSpot form sign-ups, excluding internal company domains.
- **Registration started / account created / account verified:** PostHog's first `registration_started`, `account_created` and `account_verified` per person, excluding the `Internal` class, `qa_probe` events and test accounts. The 200 target counts **account_verified**.
- **Conversion** is only computed inside one source (sessions → form, registration → created → verified) or across the person-level match. HubSpot and PostHog steps are never divided by each other; those steps show "sources not matched".
- **Form → verified account:** form submissions whose HMAC email hash (`EMAIL_HASH_KEY`) matches a verified PostHog person, out of the form submissions that have a hash. Without the key it shows "pending". Only people with an email in PostHog can match.
- **Invitations:** per recipient of the marketing emails in `HUBSPOT_INVITE_EMAIL_IDS`. Replied = contact property `hs_sales_email_last_replied` after the first send. Closed = bounced or unsubscribed without a reply. Accepted = invitee who submitted the form. Enrolled = invitee with a verified account. Without the variables the section says "source pending".
- **Builders:** active = at least one project (`POSTHOG_PROJECT_CREATED_EVENT`) **and** published content recorded with URL and date (`POST api/builders/:code/content`, admin and program manager only). Day 0 = `POSTHOG_CREDITS_EVENT` (default `credits_granted`); while that event never arrives, Day 0 stays pending.

## Run on Think (Node.js service)

| Setting | Value |
|---------|-------|
| Start command | `node server.js` (service `app`) |
| Install | `npm install` (one dependency: `mysql2`) |
| Health check | `GET health` returns `{"status":"ok","mode":"live"}` |

Set the variables in **Terminal → Services → app → Environment variables**, then restart the service. Never put them in code, in `public/` or in chat.

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | injected | Listen port. There is no fallback |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | injected | MySQL connection. There is no localhost fallback |
| `BASE_PATH` | injected | The session cookie `Path` is scoped to this prefix |
| `ACCESS_PASSWORD` | yes, until SSO is live | The shared access password, at least 12 characters. `DEMO_PASSWORD` is still read as a fallback so existing settings keep working |
| `SESSION_SECRET` | recommended | At least 32 random characters. Without it, a temporary secret is used and everyone is signed out on restart |
| `TRUST_PROXY` | `1` on Think | Sets `Secure` cookies on HTTPS and applies the per-visitor rate limit |
| `HOST` | no | Defaults to `0.0.0.0` |
| `SESSION_TTL_HOURS`, `COOKIE_SECURE` | no | Session lifetime (default 8 hours) and forced `Secure` cookies |
| `AUTH_DEV_LOGIN` | never on Think | `1` enables `auth/dev-login`, for loopback only |

Locally: `PORT=3016 npm run dev` (dev login) or `PORT=3016 ACCESS_PASSWORD="…" npm start`, with the `DB_*` variables exported.

## Connected sources

`lib/connectors.js` pulls the window from `LAUNCH_DATE` to today. `lib/sync.js` runs about 15 seconds after start-up and then every `SYNC_INTERVAL_HOURS`. It never blocks start-up.

| Source | Required variables | Optional variables |
|--------|--------------------|--------------------|
| HubSpot | `HUBSPOT_TOKEN` | `HUBSPOT_UTM_PROPERTIES`, `HUBSPOT_INVITE_EMAIL_IDS` (comma-separated marketing email ids; the token needs the `content` scope) |
| GA4 | `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT` (key JSON) | |
| PostHog | `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_API_KEY` | `POSTHOG_ACTIVATION_ACTION_ID`, `POSTHOG_PROJECT_CREATED_EVENT`, `POSTHOG_CREDITS_EVENT` (default `credits_granted`), `POSTHOG_PLAN_PROPERTY`, `POSTHOG_EXECUTIVE_HOSTS` |
| All | | `EMAIL_HASH_KEY` (secret for the HMAC email match; without it no hash is stored and the cross stays pending), `LAUNCH_DATE` (default `2026-10-01`), `SITE_HOSTS`, `INTERNAL_DOMAINS`, `INTERNAL_COMPANIES`, `SYNC_INTERVAL_HOURS` (default 6) |

- Each source syncs on its own, and each load is one transaction.
- A source without its variables stays **Pendiente**. A failed sync shows **Error**; the reason is in `sync_runs.error` and the service logs.
- No full email address is ever stored: only the domain and, with `EMAIL_HASH_KEY`, an HMAC-SHA256 of the normalized email (`source_events.email_hash`).
- To check a sync: `SELECT source, status, metrics_count, events_count, error FROM sync_runs ORDER BY id DESC LIMIT 10;`

## Data storage (MySQL)

| Table | Holds |
|-------|-------|
| `programs` | Name and targets (signup target 200, capacity 300, CEO target pending), `mode = live` |
| `builders` | Legacy builder-portal table, not read (builders now come from PostHog verified people) |
| `builder_content` | Published content per builder code: URL, platform, publication date, who recorded it |
| `data_sources` | HubSpot, PostHog, GA4: purpose, state, method, last sync, required variables |
| `source_metrics` | Daily metrics per source, metric, dimension and value (upserted) |
| `source_events` | Person-level rows: HubSpot form sign-ups and invitation recipients, PostHog verified people (email domain + HMAC hash only) |
| `source_snapshots` | Aggregates and coverage notes as JSON |
| `sync_runs` | One row per connector run |
| `funnel_stages` | Legacy table, no longer read and left empty |

`db/schema.sql` and `db/seed.sql` are recorded copies of what was applied. The seed holds only the program targets and the three real sources. If the database is unreachable, `api/dashboard` answers 500 `Data unavailable` and the UI shows the Data unavailable panel.

## Authentication and authorization

- Every `/api/*` request needs a signed `eb_session` cookie (HttpOnly, SameSite=Strict). Responses: 401 without it, 403 for an unknown role, 503 when no secret is configured.
- **Shared-password access:** `POST auth/password-login` exists only when `ACCESS_PASSWORD` is set. It uses a timing-safe check, allows 10 failures per 15 minutes per visitor (then 429 with `Retry-After`), refuses cross-site requests and caps the body at 2 KB. It then issues the same session as any other login.
- Anyone with the password can pick any role. Share it only with people allowed to see full records, and remove it once SSO is live.
- Data is projected per role on the server (`lib/access.js`) with field and view allowlists.

| Role | Builder records | Views |
|------|-----------------|-------|
| `admin`, `program_manager` | Full | All, including landing channels |
| `research` | Pseudonymous (no email or city) | All, including landing channels |
| `executive` | None | Overview |
| `marketing` | None | Overview, Enrollment (with landing channels) |

Endpoints: `GET health`, `GET api/dashboard`, `GET api/session`, `POST api/builders/:code/content` (admin, program manager), `GET auth/logout`, `POST auth/password-login`, `GET auth/dev-login?role=…` (opt-in, loopback only).

**SSO (planned):** implement the OIDC callback in `lib/app.js` (see the INTEGRATION POINT comment). Map IdP groups to the roles above and call `issueSessionCookie`, then remove `ACCESS_PASSWORD`.

## UI structure

The UI is plain HTML/CSS/JS with relative URLs only. `public/index.html` is the shell. Pure logic lives in `public/dashboard-core.js`, the controller in `public/app.js`, texts (ES/EN) in `js/i18n.js`, helpers in `js/ui.js`, and screens in `js/views/` (overview, builders, invitations, sources, states).

## Tests

    npm test

The tests use `node --test`, need no database and never load `mysql2`. They use synthetic records from `test/fixtures/dashboard.json`, which the server never reads.

| File | Covers |
|------|--------|
| `core.test.js` | Pure dashboard rules, including no conversion across sources and the verified-account target |
| `email-hash.test.js` | Email normalization, HMAC and pseudonymous codes |
| `session.test.js` | Session tokens |
| `access.test.js` | Per-role projection, including channels |
| `password-auth.test.js` | Password check, rate limit, body parsing, same-origin |
| `dashboard-repo.test.js` | Funnel and channels built from synced data, zeros without data, internal accounts excluded, `DB_*` config |
| `connectors.test.js`, `sync.test.js` | Connectors and the sync scheduler |
| `server.test.js` | HTTP integration: auth, roles, password login, no fallback without a loader, config |

CI runs the suite on Node 18, 20 and 22.
