# Folio deployment — Supabase + Cloudflare

## Current status

- Repository: https://github.com/Apps24/folio-reader (created by owner, currently public).
- Supabase integration is implemented; no production database has been selected or provisioned.
- Connected Supabase account currently lists no projects and one organization, **Apps24's Org** (`fupmlwixivzjfvgffxis`). Project creation requires the owner's organization choice and review of the quoted project cost.
- Local database security tests and production build pass. Live save/retrieve, email, billing and voice checks remain pending.

## 1. Create the Supabase project

Confirm whether to create **folio-reader** in **Apps24's Org**, preferably Mumbai (`ap-south-1`) for the owner's region. Alternatively create it yourself in the Supabase dashboard and send the project URL. Do not send your database password or secret key in chat.

Before creating, check the organization's plan and available project quota. App Free/Plus membership is independent of the Supabase hosting plan. We have not approved or activated paid infrastructure.

## 2. Apply database and Storage setup

Apply `supabase/migrations/20260914115404_folio_accounts_books.sql` once to the dedicated project using the SQL Editor or the connected database tools. This creates all app tables, RLS policies, a private `epubs` bucket (50 MiB limit) and service-only voice quota functions. Do not manually make the bucket public.

The migration includes explicit role grants required by current Data API defaults. All exposed tables have RLS. The private book-limit trigger verifies the signed-in owner and serializes reservations. User-editable Auth metadata is used only for a display name, never for paid access.

After applying, run Supabase security advisors and verify table/bucket configuration. Then test two disposable accounts: upload an EPUB, save notes/progress, sign out, sign back in and retrieve them; the second account must see an empty shelf and receive no access to the first account's files. Verify a sixth Free book fails, including direct API inserts.

## 3. Configure Supabase Auth

In Authentication settings enable Email/Password. Keep email confirmation enabled and set a minimum password length of 12. Set Site URL to the actual deployed Folio HTTPS origin and add that origin to allowed redirect URLs. For local testing add the exact local URL printed by Wrangler or Vite.

Configure custom SMTP for signups by real users. The default Supabase email sender has testing restrictions and rate limits; check current settings before launch. Registration displays a confirmation-email message when no session is returned. Add password recovery UI before public commercial launch.

## 4. Configure Cloudflare

Create/deploy a **Worker with static assets**, named `folio-reader`; no D1 database or R2 bucket is needed for this version. Use the new repository's own GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. LOTM repository secrets do not automatically transfer. The token needs Workers deployment permission and Workers AI access for paid narration.

In Cloudflare Worker Settings → Variables and Secrets, add:

| Name | Value | Exposure |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL from Supabase Connect | Public configuration |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) | Public configuration |
| `SUPABASE_SECRET_KEY` | Secret key (`sb_secret_…`) | Encrypted Worker secret only |
| `APP_ORIGIN` | Actual deployed Folio HTTPS origin | Public configuration |

Keys are in Supabase Project Settings → API Keys / Connect. Never use a secret key as the publishable key, put secrets in `VITE_*`, or commit `.dev.vars`. The frontend fetches only URL/publishable key from `/api/config`, so a separate frontend rebuild is not needed to change these values.

Run the GitHub **Deploy Folio** workflow from `main`. The workflow builds and deploys; it deliberately does not apply database changes automatically. If creating the Worker through this first deployment, add its settings afterward and verify `/api/health` reports `configured: true`. `/api/config` must contain no secret key. Then verify the account and EPUB flows above. This configured flag checks settings presence, not connection health.

## 5. Activate paid features

Choose the subscription price/currency and use an eligible Stripe merchant account. Set encrypted Worker secrets `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET`. Set the signed webhook URL to `https://ACTUAL_ORIGIN/api/billing/webhook`. Subscribe to checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid and invoice.payment_failed. Enable the Stripe customer portal.

Verify payments, cancellation, expiry and duplicate/reordered webhooks in Stripe test mode. The Worker fetches current subscription state rather than trusting browser redirects. A downgrade preserves existing books but prevents new imports while five or more remain. Verify Free users cannot call AI, successful generation consumes usage, and provider errors refund it. Default monthly allowance is 100,000 characters; costs and provider limits are separate.

## Rollback and operations

Redeploy the previous verified Worker version; preserve database and Storage contents. Keep future migrations compatible with the previous Worker until rollout completes. Set up backups, monitoring, stale upload/orphan-file cleanup and load testing before commercial launch. Storage and bandwidth remain finite even when the app advertises unlimited paid book slots.

## Official references

- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/api/securing-your-api
