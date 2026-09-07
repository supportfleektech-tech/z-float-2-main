# Z-float — Credentials Register (`credentials.md`)

Everything you need to **obtain, insert and verify** before Z-float can move
real money, send real email/SMS, or store real objects. Work through the
sections in order. After inserting anything, re-run:

```bash
pnpm check:creds          # live readiness table (✓ ok / ◈ vault / ⚠ attention / ✗ missing)
pnpm secrets list         # if using the vault: shows source per secret
```

> **Where to put credentials**
> - **Local dev / staging:** export values in `.env` (never commit it).
> - **Production:** seal them in the secrets vault — `SECRETS_DRIVER=kms`,
>   then `pnpm secrets set NAME value --driver kms` writes an encrypted
>   envelope to `SECRETS_DIR/<NAME>.json`. Env vars always win over the vault,
>   so don't ALSO export the same name in production.
> - Never paste real values into this file, `.env.example`, or any doc.

Legend: `[env]` plain env var · `[vault]` recommend vault · `[required]` blocks production.

---

## 1. Core secrets — required for ANY production deploy

| # | Credential | Env var | Get it from | Notes |
|---|---|---|---|---|
| 1.1 | Session signing secret | `SESSION_SECRET` | `openssl rand -base64 48` | ≥32 chars. Rotating logs everyone out — rotate only on incident (RB-08). |
| 1.2 | At-rest encryption key | `ENCRYPTION_KEY` | `openssl rand -hex 32` | 64 hex chars = 32 bytes. Encrypts TOTP secrets etc. Zero-key is refused in production config. |
| 1.3 | Database URL | `DATABASE_URL` | Hosting provider (AWS RDS / Neon / Supabase / self-hosted) | Postgres 15+. SSL enforced; least-privilege user; backups on. |
| 1.4 | Redis/Valkey URL | `REDIS_URL` | Upstash / Redis Cloud / self-hosted | BullMQ queues + rate limiting + worker heartbeat. |
| 1.5 | Admin bootstrap | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Generate a strong password | Only used to bootstrap the platform admin; demo seed is OFF in prod. |

**Verify:** `pnpm check:creds` → Core secrets all `✓ ok`.

## 2. Safaricom Daraja (M-Pesa) — live certification

Registration path (Kenya):
1. **Daraja developer portal** → `developer.safaricom.co.ke` — register a
   **production app** (you need a Safaricom partnership/contract or go
   through an aggregator for disbursements).
2. Request **B2C** (disbursements) and/or **STK push** (Lipa na M-Pesa) APIs;
   Safaricom approves per product and hands over go-live credentials.
3. Register the **callback URL** (public HTTPS) in the app settings.

| # | Credential | Env var | Get it from | Notes |
|---|---|---|---|---|
| 2.1 | Environment | `MPESA_ENVIRONMENT` | — | `production` only after certification. Sandbox refuses no more. |
| 2.2 | App consumer key | `MPESA_CONSUMER_KEY` | Daraja portal → app | — |
| 2.3 | App consumer secret | `MPESA_CONSUMER_SECRET` | Daraja portal → app | Vault. |
| 2.4 | STK passkey | `MPESA_PASSKEY` | Safaricom go-live pack | Base64 of `shortcode+passkey`; needed for STK push only. |
| 2.5 | Shortcode | `MPESA_SHORTCODE` | Safaricom contract | `174379` is the sandbox till — replace with your live paybill/till. |
| 2.6 | Callback base URL | `MPESA_CALLBACK_BASE_URL` | Your domain | Must be public HTTPS: `https://pay.example.com` — the adapter appends `/api/webhooks/mpesa`. No `localhost`. |
| 2.7 | B2C initiator | `MPESA_B2C_INITIATOR_NAME` | Safaricom (B2C only) | API user created in your org's M-Pesa settings. |
| 2.8 | B2C security credential | `MPESA_B2C_SECURITY_CREDENTIAL` | Safaricom (B2C only) | Base64-encrypted initiator password per Daraja spec. Vault. |

**Certification procedure (what proves it works):** see `guide.md` §6.1 — the
adapter is already contract-tested 10/10 against a Daraja-protocol emulator;
certification = pointing it at the real sandbox/live API and running the
smoke script from `guide.md`.

## 3. PesaLink / bank rails

Z-float's `bank-psp` adapter (`BANK_API_*`) is the seam for PesaLink and
RTGS/EFT bank files. Which credentials depend on your bank partner
(KCB/Equity/NCBA/Co-op or an aggregator like Cellulant/Interswitch):

| # | Credential | Env var | Get it from | Notes |
|---|---|---|---|---|
| 3.1 | API base URL | `BANK_API_BASE_URL` | Bank/aggregator API docs | PesaLink endpoints differ per bank. |
| 3.2 | API client key | `BANK_API_KEY` | Bank partner portal | — |
| 3.3 | API shared secret | `BANK_API_SECRET` | Bank partner portal | Also verifies `/api/webhooks/bank` signatures. Dev value `mock-bank-dev-secret` is REFUSED in prod posture. Vault. |

**Verify:** a sandbox PesaLink test payment through the adapter (live smoke
in `guide.md` §6.2).

## 4. AWS — real S3 + KMS vault

| # | Credential | Env var | Get it from | Notes |
|---|---|---|---|---|
| 4.1 | Storage driver | `STORAGE_DRIVER=s3` | — | `local` is dev-only. |
| 4.2 | Bucket | `S3_BUCKET` | AWS console | Create once; enable **versioning + SSE-KMS**, lifecycle to expire old report artifacts (retention is per report schedule). Tenant prefixes are handled by the app. |
| 4.3 | Region | `S3_REGION` | AWS console | e.g. `eu-west-1` (or `af-south-1` Cape Town for Kenyan data residency). |
| 4.4 | Access key id | `S3_ACCESS_KEY_ID` | AWS IAM | Least-privilege user (s3:Get/Put/Delete on the bucket only) — or an **instance role**; then leave the key vars unset. |
| 4.5 | Secret access key | `S3_SECRET_ACCESS_KEY` | AWS IAM | Vault. |
| 4.6 | KMS key (vault) | `SECRETS_KMS_KEY_ID` | AWS KMS | `alias/zfloat-secrets`. App role needs only `kms:Decrypt` (+ `kms:Encrypt` on the ops box that seals secrets). |
| 4.7 | Secrets driver | `SECRETS_DRIVER=kms` | — | Production vault mode (C-2). |

**Verify:** `pnpm evidence` (report export path `s3://…`), `pnpm secrets set
SESSION_SECRET … --driver kms` then `pnpm secrets list`, and a put/get
round-trip through the object-store contract test against real S3.

## 5. Email (SMTP / Amazon SES)

| # | Credential | Env var | Get it from | Notes |
|---|---|---|---|---|
| 5.1 | Driver | `EMAIL_DRIVER=smtp` | — | `console`/`sink` are dev-only. |
| 5.2 | SMTP host | `SMTP_HOST` | Provider (or SES: `email-smtp.<region>.amazonaws.com`) | — |
| 5.3 | Port | `SMTP_PORT` | Provider | 587 STARTTLS or 465. |
| 5.4 | Username | `SMTP_USER` | Provider (SES: SMTP user) | — |
| 5.5 | Password | `SMTP_PASS` | Provider (SES: SMTP password) | Vault. |
| 5.6 | Sender | `EMAIL_FROM` | Provider | SES requires a **verified domain**; use `"Z-float <no-reply@yourdomain>"`. |

**Verify:** Portal → Message Center → test EMAIL send; row flips
`QUEUED → SENT` with driver `smtp`, and the inbox receives it. Templates live
in `notification_templates`.

## 6. SMS (Africa's Talking / Twilio)

The worker's `http` driver already speaks the Africa's Talking wire format.

| # | Credential | Env var | Get it from | Notes |
|---|---|---|---|---|
| 6.1 | Driver | `SMS_DRIVER=http` | — | `console` is dev-only. |
| 6.2 | Gateway URL | `SMS_PROVIDER_URL` | Provider dashboard | AT: `https://api.africastalking.com/version1/messaging` (sandbox vs production key). |
| 6.3 | API key | `SMS_API_KEY` | Provider dashboard | Vault. |
| 6.4 | Sender id | `SMS_FROM` | Provider | Must be a **registered sender id** (AT approval) or shortcode. |

**Verify:** Message Center → test SMS; row `QUEUED → SENT` and the phone
receives it (use the AT sandbox number first).

## 7. Licensed data — identity verification + watchlist feed

These two are **vendor selections**; the product seams already exist
(`verification_documents` + the KYC engine; `aml_watchlists` table). The env
names below are **reserved placeholders** — the ingestion code is added when
you choose a vendor (the config layer will grow `VERIFY_*` / `WATCHLIST_*`
validation at that point; today they are advisory only).

| # | Credential | Reserved vars | Notes |
|---|---|---|---|
| 7.1 | ID/document verification partner | `VERIFY_API_BASE_URL`, `VERIFY_API_KEY` | e.g. eCitizen-integrated ID check vendors (SmileID, Identitypass, Peleza…) — needs a KYC-services contract. |
| 7.2 | Sanctions/PEP watchlist feed | `WATCHLIST_FEED_URL`, `WATCHLIST_FEED_KEY` | Dow Jones / Refinitiv-grade licensed feed or ODPC-registered local provider; the app loads it into `aml_watchlists`. |

## 8. Infrastructure & hardening

| # | Credential | Env var | Notes |
|---|---|---|---|
| 8.1 | Cookie security | `COOKIE_SECURE=true` | Required in prod (HTTPS-only sessions). |
| 8.2 | Malware scanner | `MALWARE_SCANNER_DRIVER=clamav` + `CLAMAV_HOST`/`CLAMAV_PORT` | Run clamd (e.g. container sidecar); KYC uploads are scanned before review. `mock` is never acceptable in prod. |
| 8.3 | Runtime mode | `NODE_ENV=production`, `DEMO_MODE=false`, `SEED_DEMO_DATA=false` | Config guard refuses demo mode under production. |
| 8.4 | Public URLs | `APP_URL`, `API_URL` | HTTPS production origins. |
| 8.5 | Observability (optional) | `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` (+`OTEL_ENABLED=true`) | Sentry for errors; OTLP for traces/metrics. |

---

## After you insert everything

1. `pnpm check:creds` → expect **0 ✗ missing, 0 ⚠ attention** (or only the
   optional `OTEL_*`/`SENTRY_DSN`).
2. `pnpm secrets list` → production secrets show `envelope:kms`.
3. Run the certification smokes in `guide.md` §6 in order.
4. Re-run the full gate (`guide.md` §7) and archive a `pnpm evidence` run as
   the deployment baseline.
