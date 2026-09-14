# Folio Reader

Personal multi-book EPUB reader, hosted by a Cloudflare Worker. **Supabase Auth, PostgreSQL and private Storage** handle accounts and saved data. This replaces the original D1/R2 prototype; do not run its old migration.

Features: name/email/password registration, email confirmation handling, login/logout, private EPUB uploads, chapter navigation, search, notes, bookmarks, synced reading progress and appearance, device narration, buffered paid Aura-2 narration and Stripe subscription integration.

Free accounts have five book slots. Plus has unlimited book slots with a configurable monthly AI allowance (default 100,000 characters). Every EPUB is limited to 50 MiB. Subscription price and provider credentials must be configured before checkout becomes available. Voice here means narration, not a conversational assistant or voice cloning.

## Data and access

| Data | Location | Access |
| --- | --- | --- |
| Email, password, display name | Supabase Auth | Managed by Auth; no app password table |
| Book metadata | PostgreSQL `books` | Owner only through RLS |
| EPUB bytes | Private `epubs` Storage bucket | Owner and reserved book path only |
| Progress, notes, bookmarks, settings | PostgreSQL `reading_state` | Owner only; linked to owned book |
| Paid status, Stripe customer | PostgreSQL `entitlements` | Owner can read; only server can write |
| AI usage | PostgreSQL `voice_usage` | Owner can read; server reserves/refunds atomically |

The browser uses a publishable key. The Worker verifies its access token with Supabase Auth and passes it to database/storage requests, preserving RLS. The server secret is used only for entitlement initialization, billing and voice quotas. It is never returned by `/api/config`.

## Development

Use Node 24. Run `npm ci` and `npm run check`. Copy `.dev.vars.example` to `.dev.vars` and fill the three Supabase values after provisioning the project and applying the migration. Run `npm run local`; for frontend hot reload run `npm run dev` in a second terminal. AI requires Cloudflare authorization even during local development.

See [deployment and account setup](docs/DEPLOYMENT.md) for exact next steps and required secrets.

## Verification and limitations

Automated tests execute the unchanged migration in PGlite PostgreSQL with Supabase platform fixtures and check RLS isolation, state save/retrieval, private storage policies, book limits, privilege denial, AI reservation/refund, webhook signatures and public config. TypeScript and the production Vite build pass. These are local tests, not proof of a deployed connection. Live Auth, Storage transport, concurrent database sessions, email delivery, billing and real narration need staging verification after project creation.

Browser preview is not yet verified in this workspace; the prior Wrangler launch returned a host network-interface error. Password recovery UI, offline sync and cross-device conflict merging remain future work. EPUB rendering uses sanitized supported HTML, not DRM, scripts or original publisher CSS. Audio buffering reduces gaps but does not guarantee sample-gapless playback. Public signup requires an email delivery provider configured in Supabase.
