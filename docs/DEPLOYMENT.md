# Folio deployment — Supabase + Cloudflare R2

## Current status

- Repository: https://github.com/Apps24/folio-reader (created by owner, currently public).
- Supabase project: **folio-reader** (`mdlyiuwyjmwnuvmaskzq`) in Mumbai, provisioned in **Apps24's Org** on the Free plan.
- All checked-in migrations are applied. Supabase remains responsible for Auth and PostgreSQL metadata; new EPUB files are stored in private Cloudflare R2.
- Local database security tests, CI and the production build pass. The public Supabase URL and publishable key are deployed with the Worker; email delivery, billing and voice checks remain pending.

## 1. Supabase project (complete)

Project URL: `https://mdlyiuwyjmwnuvmaskzq.supabase.co`. App Free/Plus membership is independent of the Supabase hosting plan. No paid Supabase infrastructure was activated.

## 2. Supabase database setup

The migrations in `supabase/migrations` have been applied to the dedicated project. They create all app tables, RLS policies, the required foreign-key index and service-only voice quota functions. The old private `epubs` bucket remains temporarily so books uploaded before the R2 migration can still be read and removed.

New EPUB uploads use `/api/books/:id/file`. The Worker authenticates the Supabase JWT, verifies ownership, content length and MIME type, then streams the request body into R2 without buffering the complete book. The stored R2 object size is checked before the database row becomes ready.

The migration includes explicit role grants required by current Data API defaults. All exposed tables have RLS. The private book-limit trigger verifies the signed-in owner and serializes reservations. User-editable Auth metadata is used only for a display name, never for paid access.

After applying, run Supabase security advisors and verify table/bucket configuration. Then test two disposable accounts: upload an EPUB, save notes/progress, sign out, sign back in and retrieve them; the second account must see an empty shelf and receive no access to the first account's files. Verify a sixth Free book fails, including direct API inserts.

## 3. Configure Supabase Auth

In Authentication settings enable Email/Password. Keep email confirmation enabled and set a minimum password length of 8. Set Site URL to the actual deployed Folio HTTPS origin and add that origin to allowed redirect URLs. For local testing add the exact local URL printed by Wrangler or Vite.

Configure custom SMTP for signups by real users. The default Supabase email sender has testing restrictions and rate limits; check current settings before launch. Registration displays a confirmation-email message when no session is returned. The login screen includes password recovery and sends users back to `/?recovery=1`, which must be covered by the allowed deployed origin.

## 4. Configure Cloudflare

Create a private R2 bucket named **`folio-books`**. Do not enable its `r2.dev` public URL or attach a public custom domain. The checked-in Wrangler configuration binds it to the Worker as `BOOKS`.

Deploy the **Worker with static assets**, named `folio-reader`. Use the repository's GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts: Edit and R2 Storage: Edit permissions for this account; Workers AI access is also needed for paid narration.

The public URL, publishable key and deployed origin are checked into `wrangler.jsonc`; publishable keys are designed for browser use and all access is protected by RLS. In Cloudflare Worker Settings → Variables and Secrets, add the server secret when activating paid/server-side functionality:

| Name | Value | Exposure |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`) | Encrypted Worker secret only |

Keys are in Supabase Project Settings → API Keys / Connect. Never use a secret key as the publishable key, put secrets in `VITE_*`, or commit `.dev.vars`. The frontend fetches only URL/publishable key from `/api/config`, so a separate frontend rebuild is not needed to change these values.

Run the GitHub **Deploy Folio** workflow from `main`. The workflow builds and deploys; it deliberately does not apply database changes automatically. Verify `/api/health` reports `configured: true` and `storageConfigured: true`; `serverConfigured` remains false until the encrypted server secret is added. `/api/config` must contain no secret key. Then verify the account and EPUB flows above. These flags check binding presence, not a write test.

## 5. Activate paid features

Choose the subscription price/currency and use an eligible Stripe merchant account. Set encrypted Worker secrets `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET`. Set the signed webhook URL to `https://ACTUAL_ORIGIN/api/billing/webhook`. Subscribe to checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid and invoice.payment_failed. Enable the Stripe customer portal.

Verify payments, cancellation, expiry and duplicate/reordered webhooks in Stripe test mode. The Worker fetches current subscription state rather than trusting browser redirects. A downgrade preserves existing books but prevents new imports while five or more remain. Verify Free users cannot call AI, successful generation consumes usage, and provider errors refund it. Default monthly allowance is 100,000 characters; costs and provider limits are separate.

## Rollback and operations

Redeploy the previous verified Worker version if rollback is necessary; preserve database, R2 and legacy Supabase Storage contents. Keep the legacy bucket until its remaining objects have been migrated. Set up backups, monitoring, stale upload/orphan-file cleanup and load testing before commercial launch. Storage and bandwidth remain finite even when the app advertises unlimited paid book slots.

## Official references

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/api/securing-your-api
- https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
