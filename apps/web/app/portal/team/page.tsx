"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Label,
  Select,
  TableShell,
  Badge,
  Skeleton,
  Modal,
  Spinner,
} from "@/components/ui";
import { IdentityFields, IdentityCell, EMPTY_IDENTITY, type IdentityValue } from "@/components/identity-fields";

interface Member {
  id: string;
  fullName: string;
  email: string;
  status: string;
  mfaEnabled: boolean | null;
  createdAt: string;
  phone: string | null;
  idType: string | null;
  idNumber: string | null;
  kraPin: string | null;
}
interface Role {
  id: string;
  name: string;
}

interface InviteResult {
  invited: string;
  role: string;
  /** EMAIL in production (token goes to the inbox); IN_APP in demo. */
  channel: "EMAIL" | "IN_APP" | "none";
  deliveryId: string | null;
  invitationId: string | null;
  expiresAt: string;
  /** Maker-checker for privileged roles: NONE | PENDING. */
  roleApprovalStatus?: "NONE" | "PENDING";
  roleApprovalNote?: string | null;
}

export default function TeamPage() {
  const [users, setUsers] = useState<Member[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [notice, setNotice] = useState<InviteResult | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [idForm, setIdForm] = useState<IdentityValue>(EMPTY_IDENTITY);
  const [idPhone, setIdPhone] = useState("");
  const [idError, setIdError] = useState<string | null>(null);

  async function saveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setIdError(null);
    const res = await fetch(`/api/team/${editing.id}/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...idForm, phone: idPhone }),
    });
    const d = await res.json();
    if (!res.ok) {
      setIdError(d.error?.message ?? "Could not save");
      return;
    }
    setEditing(null);
    load();
  }

  function load() {
    fetch("/api/team")
      .then((r) => r.json())
      .then((d) => {
        setUsers(d.data?.users ?? []);
        setRoles(d.data?.roles ?? []);
      })
      .catch(() => setUsers([]));
  }
  useEffect(load, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setInviteUrl(null);
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, roleId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setBusy(false);
      setError(data.error?.message ?? "Invite failed");
      return;
    }
    const result = data.data as InviteResult;
    setNotice(result);
    // Demo mode: the token is stored (raw_token) so the UI can surface the
    // shareable link without needing a real inbox. Production has no token
    // anywhere — the invite link is emailed only.
    if (result.channel === "IN_APP" && result.invitationId) {
      const noticeRes = await fetch("/api/team/invite-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId: result.invitationId }),
      }).catch(() => null);
      if (noticeRes?.ok) {
        const noticeBody = await noticeRes.json();
        setInviteUrl(noticeBody.data?.inviteUrl ?? null);
      }
    }
    setBusy(false);
    setEmail("");
    setOpen(false);
  }

  return (
    <div>
      <PageHeader
        title="Team & roles"
        subtitle="Invite teammates with least-privilege roles. Registration is invite-based — the invitation link is emailed out-of-band."
        actions={<Button onClick={() => setOpen(true)}>+ Invite member</Button>}
      />

      {notice ? (
        <Card className="mb-4 p-5">
          <p className="text-sm font-medium text-success">✓ Invitation sent to {notice.invited}</p>
          <p className="mt-1 text-xs text-muted">
            {notice.channel === "EMAIL"
              ? `The sign-up link was emailed to ${notice.invited} (valid 7 days).`
              : notice.channel === "IN_APP"
                ? "Demo mode: no inbox delivery — here is the shareable link:"
                : "The invitation was recorded, but the delivery channel could not be reached. Contact support."}
          </p>
          {notice.roleApprovalStatus === "PENDING" ? (
            <p className="mt-2 rounded-control bg-warning/10 px-3 py-2 text-xs text-warning">
              ⏳ {notice.roleApprovalNote ?? `This ${notice.role} role grant is pending — an independent checker must approve it in the Approval center before ${notice.invited} can sign up.`}
            </p>
          ) : null}
          {inviteUrl ? (
            <p className="mt-1 break-all rounded-control bg-surface px-3 py-2 font-mono text-xs">{inviteUrl}</p>
          ) : notice.channel === "IN_APP" ? (
            <p className="mt-1 text-xs text-muted">The invite link is also available in the notification bell.</p>
          ) : null}
        </Card>
      ) : null}

      {!users ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <TableShell headers={["Name", "Email", "Phone", "Identity", "MFA", "Status", "Joined", ""]}>
          {users.map((u) => (
            <tr key={u.id} className="hover:bg-surface/60">
              <td className="px-4 py-3 font-medium">{u.fullName}</td>
              <td className="px-4 py-3 text-sm text-muted">{u.email}</td>
              <td className="px-4 py-3 font-mono text-xs">{u.phone ?? "—"}</td>
              <td className="px-4 py-3">
                <IdentityCell idType={u.idType} idNumber={u.idNumber} kraPin={u.kraPin} />
              </td>
              <td className="px-4 py-3">
                <Badge tone={u.mfaEnabled ? "success" : "warning"}>
                  {u.mfaEnabled ? "Enabled" : "Off"}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge tone={u.status === "ACTIVE" ? "success" : "neutral"}>
                  {u.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => {
                    setEditing(u);
                    setIdError(null);
                    setIdPhone(u.phone ?? "");
                    // The list shows a masked ID; re-enter it to change it.
                    setIdForm({ idType: u.idType ?? "NATIONAL_ID", idNumber: "", kraPin: u.kraPin ?? "" });
                  }}
                >
                  Identity
                </button>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite a team member"
      >
        <form onSubmit={invite} className="space-y-4">
          <div>
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.co.ke"
            />
          </div>
          <div>
            <Label htmlFor="inv-role">Role</Label>
            <Select
              id="inv-role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              required
            >
              <option value="">Select role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                "Send invite"
              )}
            </Button>
          </div>
        </form>
      </Modal>
          {editing ? (
        <Modal open onClose={() => setEditing(null)} title={`Identity · ${editing.fullName}`}>
          <form onSubmit={saveIdentity} className="space-y-4">
            <div>
              <Label htmlFor="tm-phone">Phone</Label>
              <Input id="tm-phone" inputMode="tel" value={idPhone} onChange={(e) => setIdPhone(e.target.value)} placeholder="0712 345 678" />
            </div>
            <IdentityFields prefix="tm" value={idForm} onChange={setIdForm} />
            {editing.idNumber ? <p className="text-xs text-muted">Current ID on file: {editing.idNumber}. Leave blank to clear it, or re-enter it to keep it.</p> : null}
            {idError ? <p className="text-sm text-danger">{idError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit">Save identity</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
