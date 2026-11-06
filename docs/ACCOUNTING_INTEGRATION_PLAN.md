# Accounting Integration Plan (P2-5)

## Overview
Build accounting integration to push payments, invoices, and eTIMS numbers to external accounting software (QuickBooks, Xero, Zoho Books, Sage).

## Architecture

### Database Schema (New Tables)
1. `accounting_connections` - OAuth2 connections per tenant per provider
2. `accounting_mappings` - Chart of accounts mappings (Z-float accounts → external accounts)
3. `accounting_sync_log` - Audit trail of sync operations

### Provider Integration Layer
- New package: `packages/accounting` (following providers pattern)
- OAuth2 flows for each provider (Authorization Code + PKCE)
- Token management with auto-refresh
- Circuit breaker for each provider
- Rate limiting compliance

### Sync Engine
- Queue: `accounting.sync` (new BullMQ queue)
- Push: payments, invoices, eTIMS numbers, journal entries
- Idempotency via sync log + provider reference
- Retry with exponential backoff

### API Endpoints
- `POST /api/accounting/connect` - Initiate OAuth flow
- `GET /api/accounting/callback` - OAuth callback
- `DELETE /api/accounting/connections/:id` - Disconnect
- `POST /api/accounting/sync` - Manual sync trigger
- `POST /api/accounting/webhooks/:provider` - Real-time updates

### UI Components
- Connection management page
- Chart of accounts mapping UI
- Sync status/log viewer

## Implementation Phases

### Phase 1: Database Schema (Week 1)
- Add 3 new tables to database schema
- Create migration 027_accounting_integration.sql
- Add indexes for query patterns

### Phase 2: Accounting Package (Week 1-2)
- Create `packages/accounting` with types, base adapter
- Implement OAuth2 client with PKCE
- Implement QuickBooks adapter
- Implement Xero adapter
- Implement Zoho Books adapter
- Implement Sage adapter
- Add to provider registry pattern

### Phase 3: Sync Engine (Week 2)
- Create `accounting.sync` queue
- Build sync worker
- Implement payment sync
- Implement invoice sync
- Implement eTIMS sync
- Implement journal entry sync

### Phase 4: API Layer (Week 2-3)
- OAuth connect/disconnect endpoints
- Manual sync endpoint
- Webhook endpoints for each provider
- Validation with Zod schemas

### Phase 5: UI (Week 3)
- Connection management page
- Account mapping UI
- Sync log viewer

### Phase 6: Tests & Verification (Week 3-4)
- Unit tests for adapters
- Integration tests with sandbox
- E2E tests
- Run ci:local

## OAuth2 Provider Details

| Provider | Auth URL | Token URL | Scopes |
|----------|----------|-----------|--------|
| QuickBooks | appcenter.intuit.com/connect/oauth2 | oauth.platform.intuit.com/oauth2/v1/tokens/bearer | com.intuit.quickbooks.accounting |
| Xero | login.xero.com/identity/connect/authorize | identity.xero.com/connect/token | accounting.transactions accounting.contacts accounting.settings |
| Zoho Books | accounts.zoho.com/oauth/v2/auth | accounts.zoho.com/oauth/v2/token | ZohoBooks.fullaccess.all |
| Sage | www.sageone.com/oauth2/auth/central | api.sage.com/oauth2/token | accounting:transactions accounting:contacts accounting:settings |

## Environment Variables (Add to env.ts)
```
QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REDIRECT_URI, QUICKBOOKS_ENVIRONMENT
XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI
ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI
SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, SAGE_REDIRECT_URI
ACCOUNTING_SYNC_INTERVAL_MS
```

## Security Considerations
- Encrypt stored tokens using ENCRYPTION_KEY
- PKCE for OAuth2 flows
- State parameter for CSRF protection
- Short-lived access tokens with refresh token rotation
- Webhook signature verification per provider
- Audit logging for all sync operations

## Success Criteria
- All 4 providers connect via OAuth2
- Payments sync to external accounting
- Invoices sync with eTIMS numbers
- Journal entries sync (double-entry)
- Manual sync works
- Webhooks receive real-time updates
- ci:local passes