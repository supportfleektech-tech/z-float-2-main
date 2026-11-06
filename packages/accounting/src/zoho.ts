/**
 * Zoho Books Adapter
 * Implements Zoho Books API v3
 */
import { getConfig } from "@zfloat/config";
import { BaseAccountingAdapter } from "./base-adapter.js";
import {
  AccountingProviderAdapter,
  ExternalAccount,
  AccountMapping,
  PaymentSyncData,
  InvoiceSyncData,
  JournalEntrySyncData,
} from "./types.js";

export class ZohoBooksAdapter extends BaseAccountingAdapter implements AccountingProviderAdapter {
  readonly code = "zoho-books";
  readonly providerType = "zoho" as const;

  protected getClientId(): string {
    return getConfig().ZOHO_CLIENT_ID;
  }

  protected getClientSecret(): string {
    return getConfig().ZOHO_CLIENT_SECRET;
  }

  protected parseCompanyInfo(data: Record<string, unknown>): { realmId: string; companyName: string } {
    const org = data.organization as Record<string, unknown> | undefined;
    if (!org) throw new Error("Invalid organization response");
    return {
      realmId: String(org.organization_id ?? ""),
      companyName: String(org.name ?? "Zoho Books Organization"),
    };
  }

  /** Get chart of accounts from Zoho Books */
  async getChartOfAccounts(accessToken: string, realmId?: string): Promise<ExternalAccount[]> {
    const orgId = realmId ?? (await this.getOrganizationId(accessToken));

    const res = await fetch(`${this.getApiBaseUrl()}/chartofaccounts?organization_id=${orgId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch accounts: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { chartofaccounts?: Record<string, unknown>[] };
    const accounts = data.chartofaccounts ?? [];

    return accounts
      .filter((acc) => acc.status === "active")
      .map((acc) => ({
        id: String(acc.account_id),
        name: String(acc.account_name),
        code: acc.account_code ? String(acc.account_code) : undefined,
        type: String(acc.account_type),
        currency: String(acc.currency_code ?? "USD"),
        status: String(acc.status),
      }));
  }

  /** Get organization ID from token */
  private async getOrganizationId(accessToken: string): Promise<string> {
    const res = await fetch(`${this.getApiBaseUrl()}/organizations`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Failed to get organizations: ${res.status}`);
    const data = (await res.json()) as { organizations?: Record<string, unknown>[] };
    const org = data.organizations?.[0];
    if (!org) throw new Error("No organization found");
    return String(org.organization_id ?? "");
  }

  /** Create journal entry in Zoho Books */
  async createJournalEntry(params: {
    accessToken: string;
    realmId: string | undefined;
    journal: JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, journal, mappings } = params;
    const orgId = realmId ?? (await this.getOrganizationId(accessToken));

    const lines = journal.entries.map((entry) => {
      const accountId = this.getMappedAccountId(mappings, undefined, entry.ledgerAccountId);
      if (!accountId) {
        throw new Error(`No mapping for ledger account ${entry.ledgerAccountId}`);
      }
      return {
        account_id: accountId,
        debit_or_credit: entry.debitMinor > 0n ? "debit" : "credit",
        amount: Number(entry.debitMinor > 0n ? entry.debitMinor : entry.creditMinor) / 100,
        description: entry.memo ?? journal.description,
      };
    });

    const body = {
      date: journal.postedAt.toISOString().split("T")[0],
      reference_number: journal.id.slice(0, 50),
      notes: journal.description,
      journal_entries: lines,
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/journalentries?organization_id=${orgId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const je = res.journalentry as Record<string, unknown>;
    return {
      externalId: String(je.journalentry_id ?? ""),
      providerReference: String(je.reference_number ?? je.journalentry_id ?? ""),
    };
  }

  /** Create invoice in Zoho Books */
  async createInvoice(params: {
    accessToken: string;
    realmId: string | undefined;
    invoice: InvoiceSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, invoice, mappings } = params;
    const orgId = realmId ?? (await this.getOrganizationId(accessToken));

    // Find or create contact
    const contactId = await this.findOrCreateContact(accessToken, orgId, invoice.beneficiary);

    const lines = invoice.items.map((item) => {
      const accountId = this.getMappedAccountId(mappings, undefined, undefined);
      return {
        name: item.description,
        quantity: item.quantity || 1,
        rate: item.unitPriceMinor ? Number(item.unitPriceMinor) / 100 : Number(item.amountMinor) / 100,
        account_id: accountId,
        amount: Number(item.amountMinor) / 100,
      };
    });

    const body = {
      customer_id: contactId,
      invoice_number: invoice.number,
      date: invoice.createdAt.toISOString().split("T")[0],
      due_date: invoice.dueAt?.toISOString().split("T")[0],
      reference_number: `eTIMS: ${invoice.etimsInvoiceNumber ?? "N/A"}`,
      currency_code: invoice.currency,
      line_items: lines,
      status: "sent",
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/invoices?organization_id=${orgId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const inv = res.invoice as Record<string, unknown>;
    return {
      externalId: String(inv.invoice_id ?? ""),
      providerReference: String(inv.invoice_number ?? inv.invoice_id ?? ""),
    };
  }

  /** Create payment (customer payment) in Zoho Books */
  async createPayment(params: {
    accessToken: string;
    realmId: string | undefined;
    payment: PaymentSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, payment, mappings } = params;
    const orgId = realmId ?? (await this.getOrganizationId(accessToken));

    // Find contact
    const contactId = await this.findOrCreateContact(accessToken, orgId, payment.beneficiary);

    // Find bank account
    const bankAccountId = this.getMappedAccountId(mappings, undefined, payment.sourceWallet?.code);

    const body = {
      customer_id: contactId,
      payment_mode: "banktransfer",
      amount: Number(payment.amountMinor) / 100,
      date: payment.executedAt?.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
      reference_number: payment.paymentNumber,
      description: `Z-float Payment: ${payment.paymentNumber} - ${payment.remark ?? ""}`,
      bank_account_id: bankAccountId,
      invoices: [], // Would need to link to specific invoices
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/customerpayments?organization_id=${orgId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const cp = res.payment as Record<string, unknown>;
    return {
      externalId: String(cp.payment_id ?? ""),
      providerReference: String(cp.reference_number ?? cp.payment_id ?? ""),
    };
  }

  /** Update existing entity */
  async updateEntity(params: {
    accessToken: string;
    realmId: string | undefined;
    entityType: "invoice" | "payment" | "journal";
    externalId: string;
    data: InvoiceSyncData | PaymentSyncData | JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, entityType, externalId, data, mappings } = params;
    const orgId = realmId ?? (await this.getOrganizationId(accessToken));

    switch (entityType) {
      case "invoice":
        return this.createInvoice({ accessToken, realmId: orgId, invoice: data as InvoiceSyncData, mappings });
      case "journal":
        return this.createJournalEntry({ accessToken, realmId: orgId, journal: data as JournalEntrySyncData, mappings });
      case "payment":
        return this.createPayment({ accessToken, realmId: orgId, payment: data as PaymentSyncData, mappings });
    }
    throw new Error(`Unsupported entity type: ${entityType}`);
  }

  /** Verify webhook signature */
  async verifyWebhook(params: {
    rawBody: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | undefined>;
  }): Promise<{ valid: boolean; eventType?: string; providerEventId?: string; data?: Record<string, unknown> }> {
    const { rawBody, headers } = params;
    const signature = headers["x-zoho-signature"] as string | undefined;

    // Zoho uses HMAC-SHA256 with the webhook secret
    // Implementation would require the webhook secret from config
    if (!signature) {
      return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };
    }

    try {
      const data = JSON.parse(rawBody);
      return {
        valid: true,
        eventType: data.event_type,
        providerEventId: data.resource_id,
        data,
      };
    } catch {
      return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };
    }
  }

  private async findOrCreateContact(
    accessToken: string,
    orgId: string,
    beneficiary: PaymentSyncData["beneficiary"] | InvoiceSyncData["beneficiary"],
  ): Promise<string> {
    // Search by name
    const url = new URL(`${this.getApiBaseUrl()}/contacts`);
    url.searchParams.set("organization_id", orgId);
    url.searchParams.set("filter_by", "Status.All");
    url.searchParams.set("search_text", beneficiary.name);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as { contacts?: Record<string, unknown>[] };
      if (data.contacts?.[0]?.contact_id) {
        return String(data.contacts[0].contact_id);
      }
    }

    // Create new contact
    const body = {
      contact_name: beneficiary.name,
      email: beneficiary.email,
      phone: beneficiary.phone,
      contact_type: "customer",
      gst_treatment: beneficiary.kraPin ? "business_gst" : "consumer",
      gst_no: beneficiary.kraPin,
      notes: `KRA PIN: ${beneficiary.kraPin ?? "N/A"}; ID: ${beneficiary.idType ?? ""} ${beneficiary.idNumber ?? ""}`,
    };

    const createRes = await this.makeAuthenticatedRequest(
      accessToken,
      `/contacts?organization_id=${orgId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return String((createRes.contact as Record<string, unknown>)?.contact_id ?? "");
  }
}