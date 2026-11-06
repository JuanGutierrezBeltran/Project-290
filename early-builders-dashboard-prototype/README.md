# Early Builders / Developer Network dashboard prototype

Local web prototype based on the reviewed dashboard spec and data-connection plan. It uses only synthetic fixtures in `data/dashboard.json`; it does not connect to HubSpot, PostHog, GA4, Outlook, or the Think4Ever portal.

## Run locally

Requires Node.js 18 or later. No package install is needed (zero dependencies).

Local development with the opt-in dev login:

    npm run dev

Open `http://127.0.0.1:3016`. The page asks you to sign in and offers one link per role (`auth/dev-login?role=…`). Stop with `Ctrl+C`.

Plain start (the API stays locked until a session secret and SSO are in place):

    npm start

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3016` | Listen port (always bound to `127.0.0.1`) |
| `SESSION_SECRET` | unset | HMAC key for session cookies, at least 32 characters. Unset means the API answers 503 (fail closed) |
| `AUTH_DEV_LOGIN` | unset | `1` enables `auth/dev-login`, loopback only and refused behind a proxy. Without a secret an ephemeral one is generated |
| `SESSION_TTL_HOURS` | `8` | Session lifetime |
| `COOKIE_SECURE` | unset | `1` adds `Secure` to the cookie (required once served over HTTPS) |

## Authentication and authorization (SEC-03)

- Every `/api/*` request needs a signed, unexpired `eb_session` cookie (HttpOnly, SameSite=Strict). Missing or invalid: 401. Unknown role: 403. No secret configured: 503.
- Data is projected per role on the server (`lib/access.js`) using field allowlists, so new fields from real connectors stay hidden until granted.

| Role id | Builder records | Aggregates / funnel / targets |
|---------|-----------------|-------------------------------|
| `admin` | Full | Yes |
| `program_manager` | Full | Yes |
| `research` | Pseudonymous (no email, no city) | Yes |
| `executive` | None | Yes |
| `marketing` | None | Yes, plus channel breakdown |

Endpoints: `GET health` (public), `GET api/dashboard`, `GET api/session`, `GET auth/logout`, `GET auth/dev-login?role=…` (opt-in only).

### Go-live checklist (Think4Ever SSO / OIDC)

1. Implement the OIDC callback in `lib/app.js` (see the INTEGRATION POINT comment). Validate issuer, audience, nonce and signature.
2. Map IdP groups to the role ids above and call `issueSessionCookie({ sub, role, name })`.
3. Set a strong `SESSION_SECRET` from a secret store, `COOKIE_SECURE=1`, and never set `AUTH_DEV_LOGIN` in shared environments.
4. Keep the loopback bind and expose the service only through the authenticated HTTPS proxy.

## Tests (QA-01)

    npm test

Uses the built-in `node --test` runner (no dependencies):

- `test/core.test.js`: day-14 rules, active definition, follow-up cap, search/stage filter, funnel maths (shared module `public/dashboard-core.js`).
- `test/session.test.js`: token signing, tampering, expiry, cookies.
- `test/access.test.js`: per-role projection and allowlists.
- `test/server.test.js`: integration on an ephemeral port: auth (401/403/503), role filtering, 405, path traversal, malformed encoding, dev login.

CI runs the suite on Node 18, 20 and 22 (`.github/workflows/test.yml`).

## Prototype behavior

- Separate indicators for the Developer Network close target (200 sign-ups) and Early Builders capacity (300 accounts); the CEO target stays unconfirmed.
- Invitation funnel, builder status, day-14 progress from credit grant, and project-plus-published-content active definition.
- Search and stage filters, Spanish/English display toggle, responsive views, and source status cards.
- Refresh control explains that the demo cannot synchronize.

## Before connecting real data

Do not put credentials in `public/` or `data/`. Implement server-side connectors and read-only access in this service, following `../early-builders-data-connections-plan-2026-11-05.md`. Reconcile source identities and validate `t4e_program`, `t4e_ref_key`, PostHog account IDs, credit grant dates, invitation statuses, and publication URLs before using the metrics operationally.

This is a local prototype, not a production deployment. Authentication is enforced on the API, but the SSO login itself, durable storage, scheduled imports and live API connectors are not implemented yet.
