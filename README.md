# Folio Reader

Personal multi-book EPUB reader, hosted by a Cloudflare Worker. **Supabase Auth, PostgreSQL and private Storage** handle accounts and saved data. This replaces the original D1/R2 prototype; do not run its old migration.

Features: name/email/password registration, email confirmation, password recovery, login/logout, private EPUB uploads, chapter navigation, search, notes, bookmarks, synced reading progress and appearance, device narration, buffered paid Aura-2 narration and Stripe subscription integration.

Free accounts have five book slots. Plus has unlimited book slots with a configurable monthly AI allowance (default 100,000 characters). Every EPUB is limited to 75 MiB. Subscription price and provider credentials must be configured before checkout becomes available. Voice here means narration, not a conversational assistant or voice cloning.

## Data and access

| Data | Location | Access |
| --- | --- | --- |
| Email, password, display name | Supabase Auth | Managed by Auth; no app password table |
| Book metadata | PostgreSQL `books` | Owner only through RLS |
| EPUB bytes | Private `epubs` Storage bucket | Owner and reserved book path only |
| Progress, notes, bookmarks, settings | PostgreSQL `reading_state` | Owner only; linked to owned book |
| Paid status, Stripe customer | PostgreSQL `entitlements` | Owner can read; only server can write |
| AI usage | PostgreSQL `voice_usage` | Owner can read; server reserves/refunds atomically |

The browser uses a publishable key. The Worker verifies its access token with Supabase Auth and passes it to database/storage requests, preserving RLS. Free accounts work without the server secret. The secret is used only for entitlement initialization, billing and voice quotas, and is never returned by `/api/config`.

## Development

Use Node 24. Run `npm ci` and `npm run check`. Copy `.dev.vars.example` to `.dev.vars` and fill the three Supabase values from the provisioned `folio-reader` project (`mdlyiuwyjmwnuvmaskzq`). Run `npm run local`; for frontend hot reload run `npm run dev` in a second terminal. AI requires Cloudflare authorization even during local development.

See [deployment and account setup](docs/DEPLOYMENT.md) for exact next steps and required secrets.

## Verification and limitations

Automated tests execute the unchanged migration in PGlite PostgreSQL with Supabase platform fixtures and check RLS isolation, state save/retrieval, private storage policies, book limits, privilege denial, AI reservation/refund, webhook signatures, public-only configuration and secret handling. TypeScript and the production Vite build pass. Live email delivery, billing and real narration still need staging verification with their provider credentials.

The deployed browser UI and configuration endpoint are verified after each deployment. Offline sync and cross-device conflict merging remain future work. EPUB rendering uses sanitized supported HTML, not DRM, scripts or original publisher CSS. Audio buffering reduces gaps but does not guarantee sample-gapless playback. Public signup requires an email delivery provider configured in Supabase.
