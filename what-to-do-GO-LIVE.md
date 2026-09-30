All the code you asked for is merged into GitHub `master`. What's left falls into four groups.

**1. Setup only you can do (needed to go live)**
1. **Vercel:** in the project you keep, set Root Directory to `apps/web` and add the build settings (`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, a real `ENCRYPTION_KEY`, `MALWARE_SCANNER_DRIVER=clamav`, `SEED_DEMO_DATA=false`). Then delete the two duplicate projects. This is also the fix for the preview that keeps disappearing.
2. **Railway:** host the database, Redis, the background worker and ClamAV (the virus scanner), with the settings in `DEPLOYMENT.md`.
3. **KRA eTIMS:** register your device on GavaConnect, then set `ETIMS_DRIVER=oscu`. Until then invoices are signed by a KRA simulator.
4. **Safaricom M-PESA:** register the payment notification addresses and set `MPESA_C2B_CALLBACK_TOKEN`, plus your live Daraja credentials.
5. **Production safety:**
   - turn off the demo accounts;
   - back up your `ENCRYPTION_KEY`;
   - put the secrets in AWS KMS (`SECRETS_DRIVER=kms`).

**2. Built, but not yet tested against the real services** (listed in `docs/KNOWN_LIMITATIONS.md`)
- **KRA eTIMS:** the connection follows KRA's official spec but hasn't been certified in KRA's test environment.
  - Every invoice line uses a placeholder item code; there's no product catalogue or stock reporting yet.
  - Only the head-office branch (`00`) can be set up in the app.
- **M-PESA:** tested only against a local imitation of Safaricom. No real money has moved yet.
  - Payment prompts that get no answer simply expire after 10 minutes; the app doesn't actively check their status.
- **Other services:**
  - the virus scanner hasn't been tested against a real ClamAV;
  - email and SMS haven't been tested with real providers;
  - security screening (sanctions and politically exposed persons) only uses demo data.

**3. Features not built yet**
- **Withholding tax (WHT):** only the design exists (`docs/seams/etims-vat-wht.md`).
- **Invitation emails:** team invites aren't emailed yet (the invite code is shown in the app instead).
- **Airtime:** listed in the catalogue, but not connected to a real airtime provider.
- **Reports:** CSV only, no Excel or PDF.
- **Bank payouts:** PesaLink/RTGS/EFT aren't built yet.
- **Reconciliation:** you still upload statements by CSV; there's no automatic pull from M-PESA.

**4. The full audit you pasted**
I haven't started it. This session can't save work to GitHub any more, and a new session starts from GitHub's `master`, so anything done here would be lost. Paste that same prompt into a **new session**, where the work can be saved, tested and opened as a pull request.

**Suggested order:** start the KRA GavaConnect application now, since approval takes longest. Then do Vercel and Railway, then M-PESA. After that, run the audit in a new session, or ask it to build withholding tax.

The preview is running again. Open **Website** (port 3000) in the preview panel. I reloaded the demo data, and the login, portal pages and public links all load.

1. **Reload the preview page first**, since the old page was from the server that shut down.
2. Log in with `demo@zfloat.app` / `Demo@12345`. The first login can take 5–10 seconds while the page compiles.

**Pages to check:**
- **Invoices** (`/portal/invoices`): invoice INV-000001 is signed by KRA (in test mode, not live KRA) and paid (KES 9,100). It also has receipt RCT-000001 and payment receipt PRC-000001.
- **Payments received** (`/portal/collections`): two successful payments (KES 9,100 and KES 2,500) and one failed payment (KES 1,200).
- **Customers** and **Recipients**: records show the ID number and KRA PIN alongside the phone number.
- **eTIMS settings** (`/portal/settings/etims`): the registered KRA device.
- **Public links your customer would open** (add these paths to the preview address; they change on each restart):
  - Invoice: `/r/doc_lPMml7DNTIaSVWts`
  - Receipt: `/r/doc_q5nCzUQDUcWdBQUU`
  - Payment receipt: `/r/doc_DeR-mkR8HLXiSCQT`

This preview still runs without Redis and the background worker, so payouts, email notifications, virus scanning and reports won't run here.

The preview only lasts while this session is active. Once the sandbox resets, sign-in will fail again. For a permanent address, deploy to Vercel and Railway using the steps I sent earlier.