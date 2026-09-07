#!/usr/bin/env python3
"""
Z-float architecture & workflow diagram generator.

Renders self-contained SVGs (no external resources) into docs/architecture/.
Usage:  python3 docs/architecture/gen_diagrams.py
"""
import os, html

OUT = os.path.dirname(os.path.abspath(__file__))

# ---------------- palette ----------------
INK = "#0F1B33"; MUT = "#51617C"; FAINT = "#8A97AC"; LINE = "#C9D3E3"
BG = "#F6F8FC"; WHITE = "#FFFFFF"
BLUE = "#0F5BFF"; BLUE_BG = "#EAF1FF"; BLUE_LN = "#AEC6F7"
GREEN = "#0E9F4E"; GREEN_BG = "#E6F7EE"
RED = "#C73B3B"; RED_BG = "#FBECEC"
AMBER = "#A16207"; AMBER_BG = "#FDF3E2"
PURPLE = "#6D28D9"; PURPLE_BG = "#F3EEFD"
TEAL = "#0E7490"; TEAL_BG = "#E2F3F7"

FONT = "Inter,'Segoe UI',system-ui,-apple-system,sans-serif"
# rough glyph advance estimate for overflow audit
ADV = 0.62

MARKERS = {
  "blue":  f'<marker id="m-blue" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{BLUE}"/></marker>',
  "ink":   f'<marker id="m-ink" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker>',
  "green": f'<marker id="m-green" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{GREEN}"/></marker>',
  "red":   f'<marker id="m-red" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{RED}"/></marker>',
  "amber": f'<marker id="m-amber" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{AMBER}"/></marker>',
  "purple":f'<marker id="m-purple" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{PURPLE}"/></marker>',
  "teal":  f'<marker id="m-teal" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{TEAL}"/></marker>',
}

SLUG = {INK: "ink", BLUE: "blue", GREEN: "green", RED: "red", AMBER: "amber",
        PURPLE: "purple", TEAL: "teal"}

def esc(t):
    return html.escape(str(t), quote=False)

def text(x, y, s, size=12, fill=INK, weight=400, anchor="start"):
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" fill="{fill}" '
            f'font-weight="{weight}" text-anchor="{anchor}">{esc(s)}</text>')

def text_w(x, y, s, size, maxw, fill=MUT, weight=400, anchor="start", lh=None):
    """One or two auto-wrapped lines, first line may be bold; returns svg + lines used."""
    lh = lh or size + 3.5
    out = []
    line = ""
    for word in s.split(" "):
        t = (line + " " + word).strip()
        if len(t) * ADV * size <= maxw:
            line = t
        else:
            if line:
                out.append(text(x, y, line, size=size, fill=fill, weight=weight, anchor=anchor))
                y += lh
                line = word
            else:
                line = word
    out.append(text(x, y, line, size=size, fill=fill, weight=weight, anchor=anchor))
    return "".join(out), y + lh

def rect(x, y, w, h, fill=WHITE, stroke=LINE, sw=1, rx=9):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'

def chip(x, y, w, h, label, fill=WHITE, stroke=LINE, tcol=INK, size=12, weight=600,
         sub=None, sc=MUT, lh=None, sub_size=None):
    """Centered box: bold label + optional (multi-line) sub captions."""
    out = [rect(x, y, w, h, fill, stroke, 1.2)]
    sub_size = sub_size or (size - 3.5)
    lines = sub.split("\n") if sub else []
    if not lines:
        out.append(text(x + w/2, y + h/2 + size*0.35, label, size=size, fill=tcol, weight=weight, anchor="middle"))
        return "".join(out)
    inner_h = len(lines) * (sub_size + 2.5) + 6
    label_y = y + h/2 - inner_h/2 + size*0.35
    out.append(text(x + w/2, label_y, label, size=size, fill=tcol, weight=weight, anchor="middle"))
    yy = label_y + 7
    for ln in lines:
        yy += sub_size + 2.5
        out.append(text(x + w/2, yy, ln, size=sub_size, fill=sc, anchor="middle"))
    return "".join(out)

def chipL(x, y, w, h, label, sub, fill=WHITE, stroke=LINE, tcol=INK, sc=MUT, size=11.5,
          sub_size=9.3, label_off=17, sub_off=13):
    """Left-aligned box: bold label + optional multi-line caption."""
    out = [rect(x, y, w, h, fill, stroke, 1.2)]
    out.append(text(x+11, y+label_off, label, size=size, fill=tcol, weight=600))
    if sub:
        yy = y + label_off + sub_off
        for ln in sub.split("\n"):
            out.append(text(x+11, yy, ln, size=sub_size, fill=sc))
            yy += sub_size + 3
    return "".join(out)

def arrowL(x1, y1, x2, y2, col=BLUE, sw=1.5, dash=None, marker=None):
    m = ' stroke-dasharray="5,4"' if dash else ""
    mk = SLUG.get(marker or col, marker or col)
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="{sw}"{m} '
            f'marker-end="url(#m-{mk})"/>')

def elabel(x, y, s, size=9.5, fill=MUT):
    return text(x, y, s, size=size, fill=fill)

def band(x, y, w, h, title, sub=None, fill=BG, stroke=LINE, tcol=INK, title_size=13.5):
    out = [rect(x, y, w, h, fill, stroke, 1.2)]
    if sub:
        out.append(text(x+14, y+25, title, size=title_size, fill=tcol, weight=700))
        out.append(text(x+14, y+42, sub, size=10, fill=MUT))
    else:
        out.append(text(x+14, y+24, title, size=title_size, fill=tcol, weight=700))
    return "".join(out)

def head(w, h, title, sub=None):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">']
    out.append(f'<rect width="{w}" height="{h}" fill="{BG}"/>')
    out.append(text(24, 32, title, size=19, fill=INK, weight=800))
    if sub:
        # wrap subtitle within canvas width
        ln, _ = text_w(24, 52, sub, 11, w - 80, fill=MUT)
        out.append(ln)
    return out

def foot(w, h, note, y=None):
    yy = y if y is not None else h - 26
    out = [f'<line x1="24" y1="{yy-8}" x2="{w-24}" y2="{yy-8}" stroke="{LINE}"/>']
    out.append(text(24, yy + 4, note, size=9.5, fill=FAINT))
    out.append("</svg>")
    return "".join(out)

def svg_begin(extra=""):
    return "<defs>" + "".join(MARKERS.values()) + extra + "</defs>"

# =====================================================================
# 1. SYSTEM OVERVIEW
# =====================================================================
def d1_system_overview():
    W, H = 1240, 1010
    s = head(W, H, "Z-float — system architecture overview",
             "Monorepo (pnpm workspaces) · Next.js 14 App Router · PostgreSQL (drizzle) + Redis · outbox pattern · maker-checker approvals engine")
    s.append(svg_begin())
    cx0, cw, gap = 38, 282, 13

    # ---- clients
    s.append(band(24, 66, W-48, 92, "Clients"))
    for i, (t, c, fill) in enumerate([
        ("Tenant users — portal & dashboard", BLUE, WHITE),
        ("Platform admins — admin consoles", BLUE, WHITE),
        ("Public payers — payment links / pay page", TEAL, WHITE),
        ("API consumers — REST v1 (api keys)", TEAL, WHITE),
    ]):
        s.append(chip(cx0 + i*(cw+gap), 120, cw, 32, t, fill=fill, tcol=c, size=11, weight=600))

    # ---- web band
    y2 = 184
    s.append(band(24, y2, W-48, 150, "apps/web — Next.js 14 · route groups",
                  "Auth + RBAC + TOTP MFA · rate limits · idempotency keys · secrets guard (fail-closed) · audit events on mutations"))
    chips = [
        ("Auth & sessions", "login · register · MFA · RBAC", WHITE, INK),
        ("Payments & batches", "submit → policy gate →\napprove → execute", WHITE, INK),
        ("Approval center API", "decisions → record + dispatch", PURPLE_BG, PURPLE),
        ("Payees & reversals", "recipients · suppliers ·\nreversal requests", WHITE, INK),
        ("Team invites", "privileged roles need a checker", WHITE, INK),
        ("Platform admin", "tenants · policies · pricing · fee\nrules · audit · flags (RBAC)", WHITE, INK),
        ("Ingress routes", "webhooks · public v1 · /pay", WHITE, INK),
    ]
    n = len(chips); w2 = (W - 88 - (n-1)*10) / n
    for i, (t, sub, fill, tcol) in enumerate(chips):
        s.append(chip(cx0 + i*(w2+10), y2 + 80, w2, 62, t, fill=fill, tcol=tcol, size=11.5, sub=sub,
                      sub_size=8.2, sc=MUT))

    # ---- engines band
    y3 = 366
    s.append(band(24, y3, W-48, 196, "Domain engines — packages (typed, unit/integration-tested)"))
    eng = [
        ("@zfloat/payments-core", "state machine · queue/execute · bulk\nreversals · beneficiaries · outbox ·\nfees · recon · schedules", BLUE_BG, BLUE_LN, BLUE),
        ("@zfloat/approvals", "policy evaluation · request lifecycle\nmaker ≠ checker · steps · levels ·\ndelegation guard · snapshots", PURPLE_BG, "#D5C6F2", PURPLE),
        ("@zfloat/ledger", "double-entry journals · reservations\nappend-only wallet ledger ·\nhealth checks", TEAL_BG, "#B5DEE7", TEAL),
        ("@zfloat/kyc", "watchlist screening · risk flags\nforced-approval gate on hits\ncase workflow", AMBER_BG, "#E5D3A6", AMBER),
        ("@zfloat/auth", "RBAC roles/permissions · sessions\nTOTP MFA · server-side checks", GREEN_BG, "#BCE5CC", GREEN),
        ("@zfloat/…", "notifications · audit · secrets\nstorage · observability · money\nvalidation · database schema", WHITE, LINE, INK),
    ]
    n = len(eng); we = (W - 88 - (n-1)*10) / n
    for i, (t, sub, fill, st, tcol) in enumerate(eng):
        s.append(chipL(cx0 + i*(we+10), y3 + 58, we, 126, t, sub, fill=fill, stroke=st, tcol=tcol,
                       size=11, sub_size=8.8, label_off=24, sub_off=11))

    # ---- data & execution band
    y4 = 594
    s.append(band(24, y4, W-48, 210, "Data & execution"))
    cards = [
        ("PostgreSQL  (single writer)", 340, "payments · approval_requests / _steps / _actions · wallets · journals ·\nwallet_ledger_entries (append-only) · outbox_events · beneficiaries ·\ninvitations · webhook events & deliveries · audit · KYC · reports", WHITE, LINE, INK),
        ("Redis / Valkey", 168, "BullMQ queues (10) · rate limits\nworker heartbeat · relay lease", WHITE, LINE, INK),
        ("Worker service", 244, "10 queue workers · housekeeping cron\nembedded outbox poller (5 s)\nprovider execution · ledger checks", GREEN_BG, "#BCE5CC", GREEN),
        ("Outbox relay", 200, "standalone poller (optional)\nadvisory xact-lock lease\n— exactly-one dispatch", TEAL_BG, "#B5DEE7", TEAL),
        ("Migrate", 128, "one-shot\nmigrations\n001–013", WHITE, LINE, INK),
    ]
    x = cx0
    for t, w, sub, fill, st, tcol in cards:
        s.append(chipL(x, y4 + 52, w, 146, t, sub, fill=fill, stroke=st, tcol=tcol, size=11.5,
                       sub_size=8.8, label_off=22, sub_off=12))
        x += w + 12

    # ---- outbound band
    y5 = y4 + 210 + 16
    s.append(band(24, y5, W-48, 128, "External adapters — demo runs local-sandbox + mock drivers; production requires real credentials and fails closed"))
    ext = [
        "Provider registry: local-sandbox · M-Pesa Daraja (B2C / STK / status / reversal) · bank-psp",
        "Notification drivers: in-app · SMTP · Africa's Talking-compatible HTTP SMS (console in demo)",
        "Object storage: local | S3 (KYC evidence, report exports) · Secrets vault: env → AES-256-GCM envelopes (local | AWS KMS)",
        "ClamAV malware scan for document intake · watchlist feed (demo entries until a licensed provider is connected)",
    ]
    for i, e in enumerate(ext):
        ln, _ = text_w(44, y5 + 52 + i*19, e, 10.2, W - 120, fill=INK)
        s.append(ln)
    s.append(foot(W, H, "Source of truth: apps/web routes · packages/* · services/worker + services/outbox-relay · docker-compose.yml · packages/database/custom-migrations (001–013)."))
    return "".join(s)

# =====================================================================
# 2. PAYMENT STATE MACHINE
# =====================================================================
def d2_payment_state_machine():
    W, H = 1280, 900
    s = head(W, H, "Payment state machine — the only legal transitions",
             "Every transition is a guarded server-side command: row lock (FOR UPDATE) + optimistic version + immutable status history. No provider response jumps states.")
    s.append(svg_begin())

    states = [
        ("DRAFT", "created · fee + beneficiary snapshot", WHITE, LINE, INK),
        ("VALIDATING", "AML screen · policy evaluation", WHITE, LINE, INK),
        ("PENDING_APPROVAL", "maker-checker · funds reserved,\nnot sent", PURPLE_BG, "#C9B8EF", PURPLE),
        ("APPROVED", "checker sign-off (never the maker)", PURPLE_BG, "#C9B8EF", PURPLE),
        ("QUEUED", "reservation applied · worker job", BLUE_BG, BLUE_LN, BLUE),
        ("PROCESSING", "provider attempt (attempts logged)", BLUE_BG, BLUE_LN, BLUE),
        ("PROVIDER_PENDING", "async rails — outcome via verified\ncallback or reconciliation", AMBER_BG, "#E5D3A6", AMBER),
        ("SUCCESS", "FINAL — verified callback or\nreconciliation only", GREEN_BG, "#A9DCBF", GREEN),
    ]
    n = len(states)
    w, gap = 128, 26
    x0 = 40
    y = 150
    xs = [x0 + i*(w+gap) for i in range(n)]
    centers = [x + w/2 for x in xs]
    cy = y + 41
    for i, (t, sub, fill, st, tc) in enumerate(states):
        s.append(chip(xs[i], y, w, 88, t, fill=fill, stroke=st, tcol=tc, size=11.5, sub=sub,
                      sub_size=8.4, sc=MUT))
    for i in range(n-1):
        s.append(arrowL(xs[i]+w, cy, xs[i+1], cy, BLUE, 1.8))
    labels = ["submit · validate", "policy match → request", "independent approver", "queue for execution", "payments.execution job", "async accepted (timeout ≠ failure)", "verified outcome"]
    cap_y = y + 88 + 26  # below the chip row: keeps captions clear of the state labels
    cap_x = [(xs[i]+w+xs[i+1])/2 for i in range(n-1)]
    cap_x[6] = 1074      # keep clear of the reversal curve on the right
    for i in range(n-1):
        s.append(text(cap_x[i], cap_y, labels[i], size=8.4, fill=MUT, anchor="middle"))

    # ---- terminal row
    ty = 310
    terms = [
        ("REJECTED", x0+40, 170, "approver rejected — terminal", RED_BG, "#EDB9B9", RED),
        ("FAILED", x0+300, 170, "attempt / validation failure", RED_BG, "#EDB9B9", RED),
        ("CANCELLED", x0+560, 170, "maker / ops cancelled — terminal", WHITE, LINE, INK),
    ]
    for t, x, ww, sub, fill, st, tc in terms:
        s.append(chip(x, ty, ww, 70, t, fill=fill, stroke=st, tcol=tc, size=12, sub=sub, sub_size=8.6))
    # retry note under FAILED
    s.append(text(x0+300+85, ty+96, "retry (bounded) → QUEUED", size=9, fill=RED, anchor="middle"))

    # PENDING_APPROVAL -> REJECTED;  DRAFT/VALIDATING/APPROVED/QUEUED -> CANCELLED; VALIDATING->FAILED; PROCESSING->FAILED; APPROVED->FAILED
    def drop(cx_from, y_from, y_to, col, mk):
        s.append(f'<path d="M{cx_from},{y_from} C{cx_from},{y_from+40} {cx_from},{y_to-24} {cx_from},{y_to}" fill="none" stroke="{col}" stroke-width="1.6" marker-end="url(#m-{mk})"/>')
    drop(centers[2], y+88, ty, RED, "red")          # PENDING_APPROVAL -> REJECTED
    drop(xs[0]+w/2+40, y+88, ty+1, INK, "ink")       # DRAFT-ish -> CANCELLED (visual)
    drop(centers[1], y+88, ty, RED, "red")           # VALIDATING -> FAILED (insufficient funds)
    drop(centers[4], y+88, ty, RED, "red")           # QUEUED -> FAILED (reserve failure)
    drop(centers[5], y+88, ty, RED, "red")           # PROCESSING -> FAILED
    s.append(text(xs[0]+w/2+48, ty+16, "cancel", size=8.6, fill=FAINT))
    s.append(text(centers[4]+14, ty-8, "reserve failure at queue time", size=8.6, fill=RED))

    # PROVIDER_PENDING outcomes: down arrow into a decision box
    pb = centers[6]
    s.append(f'<path d="M{pb},{y+88} L{pb},{ty+40}" stroke="{RED}" stroke-width="1.6" fill="none" marker-end="url(#m-red)"/>')
    s.append(f'<path d="M{pb},{y+88} L{pb},{ty+110} L{centers[5]},{ty+110} L{centers[5]},{ty}" stroke="{RED}" stroke-width="1.6" fill="none" marker-end="url(#m-red)"/>')
    s.append(text(pb+12, ty+30, "webhook/recon verdict", size=8.8, fill=AMBER))

    # SUCCESS -> REVERSED (right side), PROVIDER_PENDING -> REVERSED path via right column
    rev_y = 470
    s.append(chip(W-330, rev_y, 240, 84, "REVERSED", sub="checker-approved reversal · provider\nreverse + compensating journal · idempotent", fill=RED_BG, stroke="#EDB9B9", tcol=RED, size=12.5, sub_size=8.8))
    s.append(f'<path d="M{centers[7]},{y+88} C{centers[7]+40},{rev_y+10} {W-300},{rev_y-8} {W-330},{rev_y+42}" fill="none" stroke="{RED}" stroke-width="1.8" marker-end="url(#m-red)"/>')
    s.append(text(W-210, rev_y-20, "maker requests reversal → approver executes", size=9, fill=RED, anchor="middle"))
    # PROVIDER_PENDING -> REVERSED (long right-side route)
    s.append(f'<path d="M{xs[6]+w+16},{cy} C{xs[6]+w+90},{rev_y-40} {W-120},{rev_y-60} {W-120},{rev_y+0} L{W-330+240},{rev_y+20}" fill="none" stroke="{RED}" stroke-width="1.5" marker-end="url(#m-red)"/>')
    s.append(text(W-560, rev_y-52, "approved while stuck pending", size=8.6, fill=RED))

    # notes card
    ny = 600
    s.append(band(40, ny, W-80, 150, "Guard rails"))
    notes = [
        "Transitions only via transitionPayment: state map above is the only authority — anything else throws IllegalTransitionError.",
        "Finality: SUCCESS / FAILED / REVERSED arrive only from verified provider callbacks, monitor recovery or reconciliation — never from an HTTP request returning.",
        "Maker-checker: above-policy or risk-flagged payments wait in PENDING_APPROVAL; sign-off is by a distinct user; actions are immutable approval_actions rows.",
        "Outbox: transitions emit payment.succeeded / .failed / .reversed / .queued / .approval_requested in the same transaction → worker + tenant webhooks.",
    ]
    for i, n in enumerate(notes):
        ln, _ = text_w(56, ny + 58 + i*26, n, 10.5, W - 140, fill=MUT)
        s.append(ln)
    s.append(foot(W, H, "Source of truth: packages/payments-core/src/state.ts (PAYMENT_STATES + TRANSITIONS)."))
    return "".join(s)

# =====================================================================
# 3. MAKER-CHECKER END-TO-END
# =====================================================================
def d3_maker_checker():
    W, H = 1280, 900
    s = head(W, H, "Maker–checker end-to-end — every sensitive execution needs two distinct people",
             "Maker initiates → policy gate raises a request → an independent checker approves/rejects → execution runs only after sign-off. Four resource flows, one engine.")
    s.append(svg_begin())

    lane_xs = [40, 296, 552, 808, 1064]
    lane_w = 216
    top = 150
    s.append(f'<rect x="24" y="{top}" width="{W-48}" height="520" rx="10" fill="#fff" stroke="{LINE}"/>')
    heads = [
        ("MAKER", "portal (tenant user)", BLUE),
        ("Routes · policy gate", "apps/web API", TEAL),
        ("Approval engine", "@zfloat/approvals", PURPLE),
        ("CHECKER", "Approval center portal", GREEN),
        ("Execution · worker", "dispatch on APPROVED", RED),
    ]
    for i, (t, st, col) in enumerate(heads):
        x = lane_xs[i]
        s.append(f'<rect x="{x}" y="{top}" width="{lane_w}" height="40" fill="{col}"/>')
        s.append(text(x+12, top+17, t, size=12, fill="#fff", weight=700))
        s.append(text(x+lane_w/2, top+74, st, size=9.2, fill=MUT, anchor="middle"))

    flows = [
        ("①  Payment above policy threshold / risk-flagged (PENDING_APPROVAL)", PURPLE, "#C9B8EF", PURPLE_BG, [
            ("creates + submits;\ndraft → validating", "wallet not debited yet"),
            ("resolve ACTIVE policy:\ndemo ≥ KES 10,000 → APPROVER;\nprod: tenant policy; none ⇒ fail closed", ""),
            ("evaluate rules → create\nrequest (PENDING + snapshot\n+ steps)", ""),
            ("reviews; approve | reject\n(self-approval blocked)", ""),
            ("APPROVED → queue → worker\nexecutes → SUCCESS\nrejected → REJECTED", ""),
        ]),
        ("②  Add a payee to the payee book (register → PENDING)", AMBER, "#E5D3A6", AMBER_BG, [
            ("+ Add recipient / supplier\n(fills payee details)", ""),
            ("registerBeneficiary:\nrow created PENDING +\napproval request", ""),
            ("createApprovalRequest\nresource = beneficiary\nmaker ≠ checker", ""),
            ("approve → payee ACTIVE\nreject → payee REJECTED", ""),
            ("activateBeneficiary (idempotent);\npayments to non-ACTIVE payee\nare refused at submit", ""),
        ]),
        ("③  Reverse a successful / stuck payment (request → checker executes)", RED, "#EDB9B9", RED_BG, [
            ("Request reversal with a\nreason (SUCCESS or\nPROVIDER_PENDING)", ""),
            ("validates reversibility;\nraises request — nothing\nmoves yet", ""),
            ("snapshot stores payment +\nreason; resource = reversal", ""),
            ("approve → executor runs;\nreject → payment untouched", ""),
            ("provider reversePayment +\ncompensating journal →\nREVERSED (idempotent)", ""),
        ]),
        ("④  Grant a privileged role via team invite (role carries approve/reverse/manage powers)", GREEN, "#BCE5CC", GREEN_BG, [
            ("owner invites email into\nrole (APPROVER, FINANCE_\nMANAGER, ADMIN …)", ""),
            ("sensitive permission in\nrole? invite row →\nrole_approval PENDING", ""),
            ("createApprovalRequest\nresource = invite;\nregistration refused first", ""),
            ("approve → invite usable\nreject → invitation dead", ""),
            ("invitee may now register\ninto the role; role + branch\nassigned on accept", ""),
        ]),
    ]
    y0 = 220
    row_h = 96
    for r_i, (title, col, st, colbg, steps) in enumerate(flows):
        y = y0 + r_i * (row_h + 10)
        s.append(f'<rect x="40" y="{y-20}" width="{W-80}" height="15" rx="7.5" fill="{colbg}" stroke="{st}"/>')
        s.append(text(48, y-8.5, title, size=10.3, fill=col, weight=700))
        for i, (t, cap) in enumerate(steps):
            x = lane_xs[i] + 6
            s.append(rect(x, y, lane_w-12, row_h-6, WHITE, st, 1.2, rx=6))
            ln, _ = text_w(x+8, y+20, t, 8.8, lane_w-26, fill=INK, weight=500)
            s.append(ln)
            if cap:
                s.append(text(x+8, y+row_h-12, cap, size=7.8, fill=FAINT))
            if i < len(steps)-1:
                s.append(arrowL(x+lane_w-12, y+row_h/2-3, lane_xs[i+1]+6, y+row_h/2-3, col, 1.6))

    # legend + engine guarantees card
    ny = 700
    s.append(band(40, ny, W-80, 168, "Engine guarantees — identical for all four flows"))
    g = [
        "Distinct people: recordApprovalAction rejects actor == request.createdById (MAKER_CHECKER_VIOLATION); delegation cannot bypass — delegatedFor == creator is also rejected.",
        "Lifecycle: PENDING → PARTIALLY_APPROVED per level → APPROVED | REJECTED | EXPIRED; SEQUENTIAL / PARALLEL / ANY modes; min-approvers per step; role eligibility checked.",
        "Audit trail: approval_requests hold an immutable policy + context snapshot; approval_actions record who approved/rejected, when, at which level, with comment.",
        "Execution is the checker's authority: POST /api/approvals resolves the request then dispatches (payment release · batch · payee activation · reversal · role grant) — idempotent, replays cannot double-execute.",
    ]
    for i, n in enumerate(g):
        ln, _ = text_w(56, ny + 58 + i*30, n, 10.3, W - 150, fill=MUT)
        s.append(ln)
    s.append(foot(W, H, "Payments/batches follow configurable tenant policies (demo: built-in KES 10,000 threshold). Payees, reversals and privileged role invites always need a checker — fail closed, no off switch."))
    return "".join(s)

# =====================================================================
# 4. APPROVAL ENGINE LIFECYCLE
# =====================================================================
def d4_approval_engine():
    W, H = 1280, 800
    s = head(W, H, "Approval engine — request lifecycle & decision path",
             "createApprovalRequest (maker side) · recordApprovalAction (checker side) · dispatch on APPROVED · expireDueApprovals (worker cron)")
    s.append(svg_begin())

    lanes = [
        ("Maker portal", 110),
        ("Submit routes · gate", 330),
        ("Approvals engine (tx)", 610),
        ("Checker · center API", 920),
        ("Dispatch executors", 1150),
    ]
    top = 128; bottom = 470
    for name, x in lanes:
        s.append(f'<line x1="{x}" y1="{top}" x2="{x}" y2="{bottom}" stroke="{LINE}" stroke-width="1.6"/>')
        w = len(name) * 6.3 + 22
        s.append(f'<rect x="{x-w/2}" y="{top-40}" width="{w}" height="24" rx="12" fill="{BG}" stroke="{LINE}"/>')
        s.append(text(x, top-24, name, size=10.5, fill=INK, weight=700, anchor="middle"))
        s.append(f'<circle cx="{x}" cy="{top-6}" r="3.5" fill="{BLUE}"/>')

    msgs = [
        (110, 330, 170, "① submit payment / batch / payee / reversal / privileged invite", BLUE),
        (330, 610, 210, "② resolve ACTIVE policy → createApprovalRequest (PENDING + immutable snapshot + steps)", TEAL),
        (610, 330, 250, "③ resource marked PENDING — not executable", PURPLE),
        (920, 610, 310, "④ decision approve | reject (+comment)", GREEN),
        (610, 920, 350, "⑤ PARTIALLY_APPROVED (next level) / APPROVED / REJECTED", GREEN),
        (920, 330, 390, "⑥ REJECTED side-effects: payee / invite / payment rejected (payment amendable)", RED),
        (330, 1150, 440, "⑦ APPROVED → dispatch executor by request kind", BLUE),
    ]
    MARK = {"#0F5BFF": "m-blue", "#0E7490": "m-teal", "#6D28D9": "m-purple", "#0E9F4E": "m-green", "#C73B3B": "m-red"}
    def flow_label(mid, y, label, maxw, col):
        lines, cur = [], ""
        for wd in label.split(" "):
            t = (cur + " " + wd).strip()
            if len(t) * 0.62 * 9.4 <= maxw:
                cur = t
            else:
                lines.append(cur); cur = wd
        lines.append(cur)
        # center the whole block just above the arrow line
        top = y - 9 - (len(lines) - 1) * 5.5
        return "".join(text(mid, top + i * 11, ln, size=9.4, fill=col, weight=600, anchor="middle")
                       for i, ln in enumerate(lines))
    for x1, x2, y, label, col in msgs:
        mk = MARK[col]
        s.append(f'<path d="M{x1},{y} L{x2},{y}" stroke="{col}" stroke-width="1.7" marker-end="url(#{mk})"/>')
        s.append(flow_label((x1 + x2) / 2, y, label, abs(x2 - x1) - 26, col))

    # executor box
    s.append(chipL(998, 500, 258, 92, "Executors", "approveQueuedPayment · approveBatch\nactivateBeneficiary · executeApproved\nReversal · applyInviteRoleDecision", fill=BLUE_BG, stroke=BLUE_LN, tcol=BLUE, size=11, sub_size=8.6, label_off=20, sub_off=12))

    # two summary cards
    card_y = 620; card_h = 130
    s.append(rect(40, card_y, 590, card_h, WHITE, LINE, 1.2))
    s.append(text(54, card_y + 24, "recordApprovalAction — transaction guard checks", size=12, fill=PURPLE, weight=700))
    g = [
        "• request row locked FOR UPDATE; terminal state → ALREADY_RESOLVED",
        "• creator ≠ actor and creator ≠ delegatedFor → MAKER_CHECKER_VIOLATION",
        "• one action per actor per request → ALREADY_ACTED",
        "• actor role must match the current level (SEQUENTIAL) or an open step",
        "• count approvals per step vs min-approvers → escalate level or resolve",
    ]
    for i, c in enumerate(g):
        ln, _ = text_w(54, card_y + 46 + i*17, c, 9.6, 560, fill=INK)
        s.append(ln)
    s.append(rect(650, card_y, 590, card_h, WHITE, LINE, 1.2))
    s.append(text(664, card_y + 24, "Lifecycle & audit trail", size=12, fill=BLUE, weight=700))
    lc = [
        "• PENDING → PARTIALLY_APPROVED per level → APPROVED | REJECTED | EXPIRED",
        "• EXPIRED: expireDueApprovals (worker cron) closes stale requests",
        "• approval_requests: immutable policy + context + metadata snapshot",
        "• approval_actions: who · when · decision · level · comment — append-only",
        "• dispatch is idempotent — replays never double-execute",
    ]
    for i, c in enumerate(lc):
        ln, _ = text_w(664, card_y + 46 + i*17, c, 9.6, 560, fill=INK)
        s.append(ln)
    s.append(foot(W, H, "The same engine and guarantees back all four flows in 03-maker-checker-end-to-end.svg.", y=H-30))
    return "".join(s)

# =====================================================================
# 5. OUTBOX + QUEUES
# =====================================================================
def d5_outbox():
    W, H = 1280, 760
    s = head(W, H, "Outbox → queues → worker",
             "Events are committed in the same transaction as the state change; a poller (worker + optional relay) dispatches them once under a Postgres advisory-xact-lock lease.")
    s.append(svg_begin())

    # domain commands
    s.append(band(24, 92, 316, 400, "Domain commands (one tx)"))
    cmds = [
        ("submitPayment · executePayment", BLUE),
        ("requestReversal / reversal approval", RED),
        ("registerBeneficiary · activation", AMBER),
        ("batch submit / approve · fund wallet", TEAL),
        ("payment-link collect · invite approvals", PURPLE),
    ]
    for i, (c, col) in enumerate(cmds):
        s.append(chipL(40, 150 + i*66, 284, 50, c, "", fill=WHITE, size=10.5, label_off=31))

    # outbox + poller column
    s.append(chipL(372, 104, 320, 108, "outbox_events (append-only)",
                   "eventType · aggregateType/id · tenantId · payload\njsonb · created_at — inserted in the SAME tx as\nthe state change (no dual-write window)",
                   fill=WHITE, size=12, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(372, 250, 320, 88, "Poller tick (5 s)",
                   "worker (embedded) + outbox-relay standalone\npg_try_advisory_xact_lock → exactly-one\ndispatcher per tick",
                   fill=TEAL_BG, stroke="#B5DEE7", tcol=TEAL, size=12, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(372, 372, 320, 84, "dispatchOutboxTick",
                   "marks rows published in the same tx;\nper-event handleOutboxEvent — any failure\nto a queue job with retries",
                   fill=WHITE, size=12, sub_size=9, label_off=20, sub_off=13))
    s.append(arrowL(340, 250, 372, 180, BLUE, 1.8))
    s.append(elabel(352, 226, "enqueueOutbox(tx)", 9))
    s.append(arrowL(532, 212, 532, 250, TEAL, 1.8))
    s.append(arrowL(532, 338, 532, 372, TEAL, 1.8))

    # event types
    s.append(band(724, 92, 532, 224, "Events emitted (fanout + notify + batch sync)"))
    evs = [
        ("payment.succeeded · payment.failed · payment.reversed · payment.queued", GREEN),
        ("payment.approval_requested", PURPLE),
        ("batch.approved · batch.submitted · batch.validated", BLUE),
        ("beneficiary.activated · registration_requested · rejected", AMBER),
        ("balance.funded (wallet funding / payment-link collect)", TEAL),
    ]
    for i, (e, c) in enumerate(evs):
        s.append(f'<rect x="740" y="{130+i*40}" width="500" height="32" rx="6" fill="{BG}" stroke="{LINE}"/>')
        s.append(text(752, 150+i*40, e, size=10, fill=c, weight=600))

    # queues
    s.append(band(724, 340, 532, 200, "BullMQ queues consumed by the worker (10)"))
    queues = ["payments.execution", "batches.execution", "webhooks.process", "webhooks.deliver",
              "notifications.send", "payments.monitor", "schedules.dispatch", "reconciliation.run",
              "files.scan", "reports.generate"]
    for i, q in enumerate(queues):
        x = 740 + (i % 4) * 128
        y = 392 + (i // 4) * 64
        s.append(chip(x, y, 118, 30, q, fill=WHITE, tcol=TEAL, size=9, weight=600))

    # fanout details
    s.append(chipL(724, 568, 532, 110, "Fan-out & delivery",
                   "notifications.send → in-app · email (SMTP / sink / console) · SMS (AT-compatible HTTP)\nfanoutWebhookDeliveries → tenant subscriptions · HMAC-SHA256 x-zfloat-signature over\nthe exact bytes · delivery log · retries 2s→30s × 5 · batch row sync (markBatchRowOutcome)",
                   fill=GREEN_BG, stroke="#BCE5CC", tcol=GREEN, size=11.5, sub_size=8.6, label_off=20, sub_off=13))

    s.append(arrowL(692, 250, 724, 260, TEAL, 2))
    s.append(elabel(706, 240, "publish", 9))
    s.append(f'<path d="M692,400 C710,440 710,470 724,560" fill="none" stroke="{TEAL}" stroke-width="1.8" marker-end="url(#m-teal)"/>')
    s.append(elabel(700, 470, "jobs", 9))
    s.append(arrowL(692, 180, 724, 180, TEAL, 2))
    s.append(elabel(702, 170, "events", 9))
    s.append(foot(W, H, "Guarantees: same-tx write → no event loss on crash · lease arbitration → exactly-one dispatch · queue retries absorb transient failure."))
    return "".join(s)

# =====================================================================
# 6. LEDGER
# =====================================================================
def d6_ledger():
    W, H = 1280, 700
    s = head(W, H, "Wallet & ledger architecture — double-entry with an append-only per-wallet ledger",
             "Every funding / reserve / release / apply — and every denied double-spend attempt — is recorded with a balance-after == wallet-state guard.")
    s.append(svg_begin())

    # operations left
    s.append(band(24, 92, 330, 500, "Money commands (services)"))
    ops = [
        ("fundWallet · payment-link collect", "FUND entry + funding journal", GREEN),
        ("reserveFunds (submit / queue)", "RESERVE — denied attempts audited too", BLUE),
        ("applyFunds (execution)", "APPLY — principal leaves the wallet", TEAL),
        ("releaseFunds (cancel / fail)", "RELEASE", AMBER),
        ("postReversalJournal (approved reversal)", "compensating credit back to wallet", RED),
    ]
    for i, (t, sub, c) in enumerate(ops):
        y = 150 + i * 84
        s.append(f'<rect x="40" y="{y}" width="298" height="64" rx="9" fill="white" stroke="{LINE}"/>')
        s.append(f'<circle cx="{x+16 if False else 56}" cy="{y+20}" r="5" fill="{c}"/>')
        s.append(text(68, y+21, t, size=10.8, fill=INK, weight=600))
        s.append(text(68, y+42, sub, size=9, fill=MUT))

    # center core
    cx0 = 386
    s.append(band(cx0, 92, 470, 500, "Ledger core (Postgres)"))
    s.append(chipL(cx0+16, 150, 438, 92, "journals + journal_entries",
                   "double-entry: every journal balances to net zero; entries carry\ndebits/credits against chart accounts; fee & provider snapshots\nare immutable per payment",
                   fill=WHITE, size=11.5, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(cx0+16, 264, 438, 70, "chart_of_accounts (ensureSystemChart)",
                   "tenant system chart: cash / wallet, fee income, payables, suspense",
                   fill=WHITE, size=11.5, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(cx0+16, 356, 438, 70, "wallets",
                   "availableMinor + reservedMinor; serialized by row lock (atomic)",
                   fill=WHITE, size=11.5, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(cx0+16, 448, 438, 106, "wallet_ledger_entries (migration 011)",
                   "append-only audit rail — DB trigger forbids UPDATE/DELETE;\nper-type delta semantics; balance_after == wallet state guard;\nsurvives failed commands (denied attempts written in own tx)",
                   fill=TEAL_BG, stroke="#B5DEE7", tcol=TEAL, size=11.5, sub_size=9, label_off=20, sub_off=13))

    # right consumers
    s.append(band(888, 92, 368, 500, "Consumers & integrity"))
    cons = [
        ("Ledger health job (worker)", "per-journal balance + net-zero check every 10 min;\nimbalance → ledger.health.imbalance audit event", TEAL),
        ("Ledger API + portal", "listWalletLedgerEntries · countDeniedReservations\n(per wallet — portal + compliance evidence)", BLUE),
        ("Reconciliation", "statement import matches settled payments and\nprovider references", AMBER),
        ("Compliance evidence", "pnpm evidence archives ledger + wallet-ledger rows\nwith a SHA-256 manifest", GREEN),
    ]
    for i, (t, sub, c) in enumerate(cons):
        y = 150 + i * 110
        s.append(f'<rect x="904" y="{y}" width="336" height="92" rx="9" fill="white" stroke="{LINE}"/>')
        s.append(text(916, y+20, t, size=11.5, fill=c, weight=700))
        ln, _ = text_w(916, y+38, sub, 9, 316, fill=MUT, lh=12)
        s.append(ln)
    # arrows
    for i in range(5):
        s.append(arrowL(338, 182 + i*84, 402, 182 + i*84, BLUE, 1.6))
    s.append(arrowL(856, 200, 904, 190, TEAL, 1.6))
    s.append(arrowL(856, 320, 904, 300, BLUE, 1.6))
    s.append(arrowL(856, 420, 904, 410, AMBER, 1.6))
    s.append(arrowL(856, 520, 904, 510, GREEN, 1.6))
    s.append(foot(W, H, "Parallel funding: reservations serialize on the wallet row — exactly one concurrent winner; every denied attempt is still recorded (auditable, replayable)."))
    return "".join(s)

# =====================================================================
# 7. DEPLOYMENT TOPOLOGY
# =====================================================================
def d7_deployment():
    W, H = 1280, 800
    s = head(W, H, "Deployment topology",
             "Docker compose: web · worker · relay · migrate on PostgreSQL + Valkey. Secrets vault applied at boot; demo vs production driver matrix.")
    s.append(svg_begin())

    # clients
    s.append(chipL(40, 110, 250, 60, "Browsers", "portal (tenant) · admin (platform)\nmarketing · public pay page", fill=WHITE, size=11, sub_size=8.8, label_off=18, sub_off=12))
    s.append(chipL(40, 190, 250, 60, "Integrations", "REST API v1 (api keys)\nprovider webhooks (HMAC + dedupe)", fill=WHITE, size=11, sub_size=8.8, label_off=18, sub_off=12))
    s.append(chip(330, 130, 110, 84, "HTTPS / LB", fill=BLUE_BG, stroke=BLUE_LN, tcol=BLUE, size=11.5, sub="TLS · rate limit", sub_size=8.5))

    # web + infra
    s.append(chipL(480, 96, 310, 150, "apps/web — next start :3000",
                   "App Router pages + API routes · auth / RBAC / MFA\nsecrets guard (fail-closed) · serves portal + admin\nstatic marketing · PWA manifest + service worker",
                   fill=WHITE, size=12, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(830, 96, 200, 150, "PostgreSQL", "single writer · migrations 001–013\n(apply via migrate container)", fill=WHITE, size=12, sub_size=9, label_off=20, sub_off=13))
    s.append(chipL(1050, 96, 190, 150, "Valkey / Redis", "BullMQ queues · rate limits\nworker heartbeat · relay lease", fill=WHITE, size=12, sub_size=9, label_off=20, sub_off=13))

    # services
    y2 = 300
    s.append(band(40, y2, W-80, 190, "Application services (Docker targets)"))
    svcs = [
        ("web", "next start — user + admin traffic", "build: NODE_ENV=production, DEMO_MODE=false, non-zero keys (RB-10)"),
        ("worker", "10 BullMQ workers + housekeeping cron", "embedded outbox poller (5 s) · ledger health"),
        ("relay", "standalone outbox poller (optional)", "lease arbitration with the worker — scale-out N relays"),
        ("migrate", "one-shot migrate (+ demo seed only when SEED_DEMO_DATA)", "idempotent · run before deploy"),
    ]
    for i, (t, sub, note) in enumerate(svcs):
        x = 60 + i * 292
        s.append(f'<rect x="{x}" y="{y2+46}" width="272" height="122" rx="9" fill="white" stroke="{LINE}"/>')
        s.append(f'<circle cx="{x+18}" cy="{y2+68}" r="6" fill="{BLUE}"/>')
        s.append(text(x+30, y2+72, t, size=12.5, fill=INK, weight=700))
        ln, _ = text_w(x+16, y2+92, sub, 9.2, 244, fill=INK, lh=12.5)
        s.append(ln)
        ln2, _ = text_w(x+16, y2+112, note, 8.6, 244, fill=MUT, lh=11.5)
        s.append(ln2)

    # arrows
    s.append(arrowL(320, 172, 480, 172, BLUE, 1.8))
    s.append(arrowL(440, 200, 480, 200, BLUE, 1.8))
    s.append(f'<path d="M700,{y2} C700,{y2-20} 860,{y2-20} 900,{y2-8} L900,{y2-46}" fill="none" stroke="{TEAL}" stroke-width="1.8" marker-end="url(#m-teal)"/>')
    s.append(f'<path d="M760,{y2} L760,{y2+46}" stroke="{INK}" stroke-width="1.6" marker-end="url(#m-ink)"/>')
    s.append(text(766, y2+26, "web + worker + relay read/write", size=9, fill=FAINT))

    # external systems
    y3 = 526
    s.append(band(40, y3, W-80, 112, "External systems — demo: local-sandbox + mock drivers · production: real credentials, fail-closed"))
    ext = [
        ("M-Pesa Daraja", "B2C · STK · status · reversal", 0),
        ("Bank / PSP rails", "bank-psp adapter", 1),
        ("Email (SMTP/SES) · SMS", "Africa's Talking-compatible HTTP", 2),
        ("Object storage", "local | S3 (KYC · reports)", 3),
        ("ClamAV", "malware scan (files.scan)", 4),
        ("AWS KMS", "secret envelopes (SECRETS_DRIVER)", 5),
    ]
    for t, sub, i in ext:
        x = 60 + i * 202
        s.append(chipL(x, y3 + 46, 186, 54, t, sub, fill=WHITE, size=10.5, sub_size=8.2, label_off=20, sub_off=10))

    # env matrix
    y4 = 660
    s.append(band(40, y4, W-80, 102, "Environment posture", None, fill=WHITE))
    ln1, _ = text_w(56, y4+42, "Demo/dev: DEMO_MODE=true · built-in KES 10,000 approval threshold · seeded demo tenant · local-sandbox provider · dev-only credentials in seed", 10, W-140, fill=INK)
    s.append(ln1)
    ln2, _ = text_w(56, y4+58, "Production: DEMO_MODE=false · SEED_DEMO_DATA=false · COOKIE_SECURE=true · ACTIVE tenant approval policy (APPROVAL_POLICY_REQUIRED) · non-zero ENCRYPTION_KEY/SESSION_SECRET · KMS vault", 10, W-140, fill=RED)
    s.append(ln2)
    ln3, _ = text_w(56, y4+76, "Env guards in packages/config are strict under NODE_ENV=production/staging — see docs/runbooks.md RB-10 and docs/production-checklist.md.", 9, W-140, fill=FAINT)
    s.append(ln3)
    s.append("</svg>")
    return "".join(s)

# =====================================================================
# gallery html
# =====================================================================
def gallery(files):
    cards = ""
    for f, label, blurb in files:
        svg = open(os.path.join(OUT, f), encoding="utf8").read()
        cards += (
            f'<section id="{f[:2]}" style="margin:0 0 44px;padding:10px 10px 4px;background:#fff;'
            f'border:1px solid #dde4ef;border-radius:14px;box-shadow:0 1px 3px rgba(15,27,51,.07)">'
            f'<h2 style="font:700 16px/1.3 Inter,\'Segoe UI\',system-ui,sans-serif;color:#0F1B33;margin:6px 6px 2px">{label}</h2>'
            f'<p style="font:400 12.5px/1.5 Inter,\'Segoe UI\',system-ui,sans-serif;color:#51617C;margin:2px 6px 10px">{blurb}</p>{svg}</section>'
        )
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Z-float architecture &amp; workflow diagrams</title>
<style>body{{margin:0;background:#EFF3F9;color:#0F1B33;font:14px/1.5 Inter,'Segoe UI',system-ui,sans-serif}}
header{{padding:22px 28px 6px;max-width:1340px;margin:0 auto}}h1{{font-size:22px;margin:0}}
p.lead{{color:#51617C;max-width:1150px}}
nav a{{display:inline-block;margin:2px 6px 10px 0;padding:4px 12px;border:1px solid #C9D3E3;border-radius:99px;background:#fff;text-decoration:none;color:#0F5BFF;font-size:12.5px;font-weight:600}}
main{{padding:0 28px 40px;max-width:1340px;margin:0 auto}}section svg{{display:block;max-width:100%;height:auto}}
</style></head><body><header><h1>Z-float — system architecture &amp; workflow diagrams</h1>
<p class="lead">Generated from the implementation (September 2026, maker-checker hardening included). Each panel is a standalone SVG in <code>docs/architecture/</code>; regenerate with <code>python3 docs/architecture/gen_diagrams.py</code>.</p>
<nav><a href="#01">System overview</a><a href="#02">Payment state machine</a><a href="#03">Maker–checker end-to-end</a><a href="#04">Approval engine lifecycle</a><a href="#05">Outbox &amp; queues</a><a href="#06">Ledger</a><a href="#07">Deployment</a></nav></header>
<main>{cards}</main></body></html>"""

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("01-system-overview.svg", "System architecture overview", "Clients → Next.js route groups → domain engines → Postgres/Redis → worker/relay → external adapters."),
        ("02-payment-state-machine.svg", "Payment state machine", "The only legal transitions — approval, execution, retries, verified finality, maker-checker reversal."),
        ("03-maker-checker-end-to-end.svg", "Maker–checker end-to-end", "Payments, payees, reversals and privileged role invites — the same maker → checker → execute engine."),
        ("04-approval-engine-lifecycle.svg", "Approval engine lifecycle", "Request creation, guard checks inside recordApprovalAction, resolution, dispatch, expiry."),
        ("05-outbox-queues.svg", "Outbox & worker queues", "Transactional event writes, lease-arbitrated dispatch, the 10 BullMQ queues and fan-out."),
        ("06-ledger-architecture.svg", "Wallet & ledger architecture", "Double-entry journals, reservations, append-only wallet ledger and integrity jobs."),
        ("07-deployment-topology.svg", "Deployment topology", "Docker services, data stores, external systems, environment posture."),
    ]
    fn = {"01-system-overview": d1_system_overview, "02-payment-state-machine": d2_payment_state_machine,
          "03-maker-checker-end-to-end": d3_maker_checker, "04-approval-engine-lifecycle": d4_approval_engine,
          "05-outbox-queues": d5_outbox, "06-ledger-architecture": d6_ledger,
          "07-deployment-topology": d7_deployment}
    for fname, label, blurb in jobs:
        with open(os.path.join(OUT, fname), "w", encoding="utf8") as f:
            f.write(fn[fname.rsplit(".", 1)[0]]())
        print("wrote", fname)
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf8") as f:
        f.write(gallery(jobs))
    print("wrote index.html")
