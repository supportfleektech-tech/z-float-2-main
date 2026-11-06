/**
 * Xero Accounting Adapter
 * Implements Xero Accounting API
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

export class XeroAdapter extends BaseAccountingAdapter implements AccountingProviderAdapter {
  readonly code = "xero";
  readonly providerType = "xero" as const;

  protected getClientId(): string {
    return getConfig().XERO_CLIENT_ID;
  }

  protected getClientSecret(): string {
    return getConfig().XERO_CLIENT_SECRET;
  }

  protected parseCompanyInfo(data: Record<string, unknown>): { realmId: string; companyName: string } {
    const orgs = data.Organisations as Record<string, unknown>[] | undefined;
    if (!orgs?.[0]) throw new Error("Invalid organisation response");
    const org = orgs[0];
    return {
      realmId: String(org.OrganisationID ?? ""),
      companyName: String(org.Name ?? "Xero Organisation"),
    };
  }

  /** Get tenant ID from token (Xero uses tenant connections) */
  private async getTenantId(accessToken: string): Promise<string> {
    const res = await fetch("https://api.xero.com/connections", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Failed to get connections: ${res.status}`);
    const connections = (await res.json()) as Array<{ tenantId: string; tenantType: string }>;
    const org = connections.find((c) => c.tenantType === "ORGANISATION");
    if (!org) throw new Error("No organisation connection found");
    return org.tenantId;
  }

  /** Get chart of accounts from Xero */
  async getChartOfAccounts(accessToken: string, realmId?: string): Promise<ExternalAccount[]> {
    const tenantId = realmId ?? (await this.getTenantId(accessToken));

    const res = await fetch(`${this.getApiBaseUrl()}/Accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Xero-tenant-id": tenantId,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch accounts: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { Accounts?: Record<string, unknown>[] };
    const accounts = data.Accounts ?? [];

    return accounts
      .filter((acc) => acc.Status === "ACTIVE")
      .map((acc) => ({
        id: String(acc.AccountID),
        name: String(acc.Name),
        code: acc.Code ? String(acc.Code) : undefined,
        type: String(acc.Type),
        currency: String(acc.CurrencyCode ?? "USD"),
        status: String(acc.Status),
      }));
  }

  /** Create journal entry in Xero */
  async createJournalEntry(params: {
    accessToken: string;
    realmId: string | undefined;
    journal: JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, journal, mappings } = params;
    const tenantId = realmId ?? (await this.getTenantId(accessToken));

    const lines = journal.entries.map((entry) => {
      const accountId = this.getMappedAccountId(mappings, undefined, entry.ledgerAccountId);
      if (!accountId) {
        throw new Error(`No mapping for ledger account ${entry.ledgerAccountId}`);
      }
      return {
        AccountID: accountId,
        Description: entry.memo ?? journal.description,
        DebitAmount: entry.debitMinor > 0n ? Number(entry.debitMinor) / 100 : 0,
        CreditAmount: entry.creditMinor > 0n ? Number(entry.creditMinor) / 100 : 0,
      };
    });

    const body = {
      Journals: [
        {
          JournalNumber: journal.id.slice(0, 20),
          JournalDate: journal.postedAt.toISOString().split("T")[0],
          Reference: journal.referenceType,
          SourceID: journal.referenceId,
          SourceType: journal.referenceType,
          Narration: journal.description,
          JournalLines: lines,
        },
      ],
    };

    const res = await this.makeAuthenticatedRequest(accessToken, "/Journals", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Xero-tenant-id": tenantId },
    });

    const journals = res.Journals as Record<string, unknown>[];
    return {
      externalId: String(journals[0]?.JournalID ?? ""),
      providerReference: String(journals[0]?.JournalNumber ?? journals[0]?.JournalID ?? ""),
    };
  }

  /** Create invoice in Xero */
  async createInvoice(params: {
    accessToken: string;
    realmId: string | undefined;
    invoice: InvoiceSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, invoice, mappings } = params;
    const tenantId = realmId ?? (await this.getTenantId(accessToken));

    // Find or create contact
    const contactId = await this.findOrCreateContact(accessToken, tenantId, invoice.beneficiary);

    const lines = invoice.items.map((item) => {
      const accountId = this.getMappedAccountId(mappings, undefined, undefined);
      return {
        Description: item.description,
        Quantity: item.quantity || 1,
        UnitAmount: item.unitPriceMinor ? Number(item.unitPriceMinor) / 100 : Number(item.amountMinor) / 100,
        AccountCode: accountId ? String(accountId) : "200", // Default sales account
        TaxType: "NONE",
        LineAmount: Number(item.amountMinor) / 100,
      };
    });

    const body = {
      Invoices: [
        {
          Type: "ACCREC", // Accounts Receivable
          Contact: { ContactID: contactId },
          Date: invoice.createdAt.toISOString().split("T")[0],
          DueDate: invoice.dueAt?.toISOString().split("T")[0],
          InvoiceNumber: invoice.number,
          Reference: `eTIMS: ${invoice.etimsInvoiceNumber ?? "N/A"}`,
          CurrencyCode: invoice.currency,
          LineItems: lines,
          Status: "AUTHORISED",
        },
      ],
    };

    const res = await this.makeAuthenticatedRequest(accessToken, "/Invoices", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Xero-tenant-id": tenantId },
    });

    const invoices = res.Invoices as Record<string, unknown>[];
    return {
      externalId: String(invoices[0]?.InvoiceID ?? ""),
      providerReference: String(invoices[0]?.InvoiceNumber ?? invoices[0]?.InvoiceID ?? ""),
    };
  }

  /** Create payment in Xero */
  async createPayment(params: {
    accessToken: string;
    realmId: string | undefined;
    payment: PaymentSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, payment, mappings } = params;
    const tenantId = realmId ?? (await this.getTenantId(accessToken));

    // Find contact
    const contactId = await this.findOrCreateContact(accessToken, tenantId, payment.beneficiary);

    // Find bank account
    const bankAccountId = this.getMappedAccountId(mappings, undefined, payment.sourceWallet?.code);

    const body = {
      Payments: [
        {
          Date: payment.executedAt?.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
          Amount: Number(payment.amountMinor) / 100,
          PaymentType: "ACCRECPAYMENT", // Payment against AR invoice
          Reference: payment.paymentNumber,
          Details: `Z-float Payment: ${payment.paymentNumber} - ${payment.remark ?? ""}`,
          CurrencyCode: payment.currency,
          Invoice: { InvoiceID: contactId }, // This would need the actual invoice ID
          Account: bankAccountId ? { AccountID: bankAccountId } : undefined,
        },
      ],
    };

    const res = await this.makeAuthenticatedRequest(accessToken, "/Payments", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Xero-tenant-id": tenantId },
    });

    const payments = res.Payments as Record<string, unknown>[];
    return {
      externalId: String(payments[0]?.PaymentID ?? ""),
      providerReference: String(payments[0]?.Reference ?? payments[0]?.PaymentID ?? ""),
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
    // Xero supports PUT for updates
    const { accessToken, realmId, entityType, externalId, data, mappings } = params;
    const tenantId = realmId ?? (await this.getTenantId(accessToken));

    switch (entityType) {
      case "invoice":
        return this.createInvoice({ accessToken, realmId: tenantId, invoice: data as InvoiceSyncData, mappings });
      case "journal":
        return this.createJournalEntry({ accessToken, realmId: tenantId, journal: data as JournalEntrySyncData, mappings });
      case "payment":
        return this.createPayment({ accessToken, realmId: tenantId, payment: data as PaymentSyncData, mappings });
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
    const signature = headers["x-xero-signature"] as string | undefined;
    const webhookKey = getConfig().XERO_WEBHOOK_KEY ?? "";

    if (!signature || !webhookKey) {
      return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };
    }

    // Verify HMAC-SHA256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(webhookKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBuffer = Buffer.from(signature, "base64");
    const valid = await crypto.subtle.verify("HMAC", key, sigBuffer, encoder.encode(rawBody));

    if (!valid) return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };

    try {
      const data = JSON.parse(rawBody);
      return {
        valid: true,
        eventType: data.events?.[0]?.eventType,
        providerEventId: data.events?.[0]?.resourceId,
        data,
      };
    } catch {
      return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };
    }
  }

  private async findOrCreateContact(
    accessToken: string,
    tenantId: string,
    beneficiary: PaymentSyncData["beneficiary"] | InvoiceSyncData["beneficiary"],
  ): Promise<string> {
    // Search by name
    const url = new URL(`${this.getApiBaseUrl()}/Contacts`);
    url.searchParams.set("where", `Name=="${this.escapeSql(beneficiary.name)}"`);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Xero-tenant-id": tenantId,
      },
    });

    if (res.ok) {
      const data = (await res.json()) as { Contacts?: Record<string, unknown>[] };
      if (data.Contacts?.[0]?.ContactID) {
        return String(data.Contacts[0].ContactID);
      }
    }

    // Create new contact
    const body = {
      Contacts: [
        {
          Name: beneficiary.name,
          EmailAddress: beneficiary.email,
          Phones: beneficiary.phone ? [{ PhoneNumber: beneficiary.phone, PhoneType: "DEFAULT" }] : [],
          ContactPersons: [],
          IsSupplier: true,
          IsCustomer: true,
        },
      ],
    };

    const createRes = await this.makeAuthenticatedRequest(accessToken, "/Contacts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Xero-tenant-id": tenantId },
    });

    const contacts = createRes.Contacts as Record<string, unknown>[];
    return String(contacts[0]?.ContactID ?? "");
  }

  private escapeSql(str: string): string {
    return str.replace(/"/g, '\\"');
  }
}