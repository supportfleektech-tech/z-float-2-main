# Z-Float Deployment Guide

## Architecture
| Component | Platform | Purpose |
|-----------|----------|---------|
| Web App (`apps/web`) | Vercel | Next.js 14 App Router |
| Worker (`services/worker`) | Railway | BullMQ workers + cron |
| Outbox Relay (`services/outbox-relay`) | Railway | Outbox event processor |
| PostgreSQL | Neon | Primary database |
| Redis | Render | BullMQ queue + cache |

---

## 1. NEON POSTGRESQL (Free)

1. Go to [neon.tech](https://neon.tech) → Sign up with GitHub
2. Create Project:
   - Name: `zfloat`
   - Region: `us-east-1` (closest to Railway/Render)
   - PostgreSQL version: **16**
3. Copy **Pooled connection string** (with `-pooler` suffix):
   ```
   postgresql://neondb_owner:xxx@ep-xxx-pooler.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
4. **Save this** — you'll need it for Vercel + Railway

---

## 2. RENDER REDIS (Free)

1. Go to [render.com](https://render.com) → New → Redis
2. Name: `zfloat-redis`
3. Plan: `Free`
4. Region: `oregon` (or `virginia` if closer to Neon)
5. Wait for creation → copy **External Connection String** (rediss://...)
6. **Save this** — needed for Vercel + Railway

---

## 3. RAILWAY WORKERS (Free Tier: 500 hrs/mo)

### Create Railway Project
1. Go to [railway.app](https://railway.app) → New Project → "Deploy from GitHub repo"
2. Select `supportfleektech-tech/z-float-2-main`
3. Railway will detect `railway.json` in `services/worker` and `services/outbox-relay`

### Configure Worker Service
1. Click the **worker** service → Variables tab
2. Add these environment variables:

```env
NODE_ENV=production
DATABASE_URL=<NEON_POOLED_STRING>
REDIS_URL=<RENDER_REDIS_URL>
SESSION_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
MALWARE_SCANNER_DRIVER=clamav
DEMO_MODE=false
SEED_DEMO_DATA=false
PROVIDER_DEFAULT=local-sandbox
MOCK_PROVIDER_SECRET=<openssl rand -hex 32>
REDIS_PREFIX=zfloat
COOKIE_SECURE=true
WORKER_CONCURRENCY=5
WORKER_CRON_ENABLED=true
OUTBOX_RELAY_INTERVAL_MS=5000
OUTBOX_RELAY_LEASE_KEY=723993001
MPESA_ENVIRONMENT=sandbox
MPESA_SHORTCODE=174379
MPESA_TIMEOUT_MS=15000
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_SUCCESS_THRESHOLD=2
CIRCUIT_BREAKER_TIMEOUT_MS=30000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
OTEL_ENABLED=false
ADMIN_EMAIL=admin@zfloat.app
SECRETS_DRIVER=none
```

### Configure Outbox Relay Service
1. Click the **outbox-relay** service → Variables tab
2. Add same variables **EXCEPT** change:
```env
OUTBOX_RELAY_LEASE_KEY=723993002
# Remove: WORKER_CONCURRENCY, WORKER_CRON_ENABLED, COOKIE_SECURE, RATE_LIMIT_*
```

### Deploy Both
- Click **Deploy** on each service
- Wait for build + health checks to pass

---

## 4. VERCEL WEB APP (Free)

1. Go to [vercel.com](https://vercel.com) → Add New Project → Import `z-float-2-main`
2. **Root Directory**: `apps/web`
3. **Framework Preset**: Next.js (auto-detected)
4. **Build Command**: `pnpm install --frozen-lockfile && pnpm build` (auto from vercel.json)
5. **Output Directory**: `.next` (default)

### Environment Variables (in Vercel Project Settings → Environment Variables)
```env
DATABASE_URL=<NEON_POOLED_STRING>  # Auto-added if using Neon Vercel integration
REDIS_URL=<RENDER_REDIS_URL>
SESSION_SECRET=<same as Railway>
ENCRYPTION_KEY=<same as Railway>
NODE_ENV=production
DEMO_MODE=false
SEED_DEMO_DATA=false
PROVIDER_DEFAULT=local-sandbox
MOCK_PROVIDER_SECRET=<same as Railway>
COOKIE_SECURE=true
ADMIN_EMAIL=admin@zfloat.app
SECRETS_DRIVER=none
```

**Important**: Use the **same** `SESSION_SECRET`, `ENCRYPTION_KEY`, `MOCK_PROVIDER_SECRET` across Vercel + both Railway services.

### Deploy
- Click **Deploy**
- Wait for build to complete

---

## 5. POST-DEPLOY VERIFICATION

### Check Health Endpoints
```bash
# Web app
curl https://<your-vercel-app>.vercel.app/api/admin/health

# Worker (Railway provides URL)
curl https://<worker-url>.railway.app/health

# Outbox Relay
curl https://<outbox-relay-url>.railway.app/health
```

### Verify Queue Processing
1. In Railway worker logs, look for:
   ```
   [worker] Started processing jobs
   [cron] Scheduled jobs registered
   ```
2. In Railway outbox-relay logs:
   ```
   [outbox-relay] Started polling
   [outbox-relay] Acquired lease 723993002
   ```

### Test Payment Flow
1. Visit Vercel URL → Sign up (demo@zfloat.app / Demo@12345)
2. Create a payment → should enqueue job → worker processes → completes

---

## 6. PRODUCTION CHECKLIST

- [ ] Neon: Enable **IP Allow List** (0.0.0.0/0 for now, restrict later)
- [ ] Render Redis: Enable **IP Allow List** (Railway + Vercel IPs)
- [ ] Railway: Set custom domain if needed
- [ ] Vercel: Set custom domain
- [ ] M-Pesa: Configure real credentials (not sandbox) in Railway vars
- [ ] Rotate all generated secrets after first deploy
- [ ] Set up monitoring (Railway metrics + Vercel analytics)

---

## QUICK COMMANDS

```bash
# Generate secrets locally
openssl rand -hex 32  # Run 3 times for SESSION_SECRET, ENCRYPTION_KEY, MOCK_PROVIDER_SECRET

# Check Railway logs
railway logs --service worker
railway logs --service outbox-relay

# Check Vercel logs
vercel logs <deployment-url>

# Run migrations manually if needed
pnpm db:migrate  # Run locally with DATABASE_URL set
```

---

## TROUBLESHOOTING

| Issue | Fix |
|-------|-----|
| Worker crashes on start | Check `DATABASE_URL` format (must be pooled Neon URL) |
| Redis connection fails | Verify Render Redis URL uses `rediss://` (TLS) |
| Jobs stuck in queue | Worker not running → check Railway logs |
| Webhook 404 | Ensure Vercel URL matches M-Pesa callback URL |
| Approval policy errors | Run `pnpm db:seed` locally against Neon to create default policy |

---

## COSTS (Monthly)
- **Neon**: Free (0.5 GB, 190 hrs)
- **Render Redis**: Free (25 MB)
- **Railway**: Free (500 hrs total across services)
- **Vercel**: Free (personal hobby)
- **Total**: $0/month for development/staging