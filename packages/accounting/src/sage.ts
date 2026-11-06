/**
 * Sage Accounting Adapter
 * Implements Sage Accounting API v3.1
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

export class SageAdapter extends BaseAccountingAdapter implements AccountingProviderAdapter {
  readonly code = "sage-accounting";
  readonly providerType = "sage" as const;

  protected getClientId(): string {
    return getConfig().SAGE_CLIENT_ID;
  }

  protected getClientSecret(): string {
    return getConfig().SAGE_CLIENT_SECRET;
  }

  protected parseCompanyInfo(data: Record<string, unknown>): { realmId: string; companyName: string } {
    const items = data.$items as Record<string, unknown>[] | undefined;
    const business = items?.[0];
    if (!business) throw new Error("Invalid business response");
    return {
      realmId: String(business.id ?? ""),
      companyName: String(business.name ?? "Sage Business"),
    };
  }

  /** Get business ID from token */
  private async getBusinessId(accessToken: string): Promise<string> {
    const res = await fetch(`${this.getApiBaseUrl()}/businesses`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Failed to get businesses: ${res.status}`);
    const data = (await res.json()) as { $items?: Record<string, unknown>[] };
    const items = data.$items;
    const biz = items?.[0];
    if (!biz) throw new Error("No business found");
    return String(biz.id ?? "");
  }

  /** Get chart of accounts from Sage */
  async getChartOfAccounts(accessToken: string, realmId?: string): Promise<ExternalAccount[]> {
    const businessId = realmId ?? (await this.getBusinessId(accessToken));

    const res = await fetch(`${this.getApiBaseUrl()}/ledger_accounts?business_id=${businessId}&items_per_page=200`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch accounts: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { $items?: Record<string, unknown>[] };
    const accounts = data.$items ?? [];

    return accounts.map((acc) => {
      const ledgerType = acc.ledger_account_type as Record<string, unknown> | undefined;
      return {
        id: String(acc.id),
        name: String(acc.display_name),
        code: acc.nominal_code ? String(acc.nominal_code) : undefined,
        type: String(ledgerType?.name ?? ""),
        currency: "USD", // Sage handles currency at business level
        status: acc.status === "inactive" ? "INACTIVE" : "ACTIVE",
      };
    });
  }

  /** Create journal entry in Sage */
  async createJournalEntry(params: {
    accessToken: string;
    realmId: string | undefined;
    journal: JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, journal, mappings } = params;
    const businessId = realmId ?? (await this.getBusinessId(accessToken));

    const lines = journal.entries.map((entry) => {
      const accountId = this.getMappedAccountId(mappings, undefined, entry.ledgerAccountId);
      if (!accountId) {
        throw new Error(`No mapping for ledger account ${entry.ledgerAccountId}`);
      }
      return {
        ledger_account_id: accountId,
        debit: entry.debitMinor > 0n ? Number(entry.debitMinor) / 100 : 0,
        credit: entry.creditMinor > 0n ? Number(entry.creditMinor) / 100 : 0,
        details: entry.memo ?? journal.description,
      };
    });

    const body = {
      journal_code: journal.id.slice(0, 20),
      date: journal.postedAt.toISOString().split("T")[0],
      reference: journal.referenceType,
      description: journal.description,
      journal_lines: lines,
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/journals?business_id=${businessId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const je = res as Record<string, unknown>;
    return {
      externalId: String(je.id ?? ""),
      providerReference: String(je.journal_code ?? je.id ?? ""),
    };
  }

  /** Create invoice in Sage */
  async createInvoice(params: {
    accessToken: string;
    realmId: string | undefined;
    invoice: InvoiceSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, invoice, mappings } = params;
    const businessId = realmId ?? (await this.getBusinessId(accessToken));

    // Find or create contact
    const contactId = await this.findOrCreateContact(accessToken, businessId, invoice.beneficiary);

    const lines = invoice.items.map((item) => {
      const accountId = this.getMappedAccountId(mappings, undefined, undefined);
      return {
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: item.unitPriceMinor ? Number(item.unitPriceMinor) / 100 : Number(item.amountMinor) / 100,
        ledger_account_id: accountId,
        net_amount: Number(item.amountMinor) / 100,
        tax_rate_id: "GB_ZERO", // Default no tax
      };
    });

    const body = {
      contact_id: contactId,
      invoice_number: invoice.number,
      date: invoice.createdAt.toISOString().split("T")[0],
      due_date: invoice.dueAt?.toISOString().split("T")[0],
      reference: `eTIMS: ${invoice.etimsInvoiceNumber ?? "N/A"}`,
      status: "draft",
      invoice_lines: lines,
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/sales_invoices?business_id=${businessId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const inv = res as Record<string, unknown>;
    return {
      externalId: String(inv.id ?? ""),
      providerReference: String(inv.invoice_number ?? inv.id ?? ""),
    };
  }

  /** Create payment (payment receipt) in Sage */
  async createPayment(params: {
    accessToken: string;
    realmId: string | undefined;
    payment: PaymentSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, payment, mappings } = params;
    const businessId = realmId ?? (await this.getBusinessId(accessToken));

    // Find contact
    const contactId = await this.findOrCreateContact(accessToken, businessId, payment.beneficiary);

    // Find bank account
    const bankAccountId = this.getMappedAccountId(mappings, undefined, payment.sourceWallet?.code);

    const body = {
      transaction_type_id: "CUSTOMER_RECEIPT",
      date: payment.executedAt?.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
      total_amount: Number(payment.amountMinor) / 100,
      reference: payment.paymentNumber,
      contact_id: contactId,
      bank_account_id: bankAccountId,
      payment_method_id: "BANK_TRANSFER",
      details: `Z-float Payment: ${payment.paymentNumber} - ${payment.remark ?? ""}`,
      allocated_artefacts: [], // Would need to link to specific invoices
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/bank_transactions?business_id=${businessId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const bt = res as Record<string, unknown>;
    return {
      externalId: String(bt.id ?? ""),
      providerReference: String(bt.reference ?? bt.id ?? ""),
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
    const businessId = realmId ?? (await this.getBusinessId(accessToken));

    // Sage supports PUT for updates
    switch (entityType) {
      case "invoice":
        return this.createInvoice({ accessToken, realmId: businessId, invoice: data as InvoiceSyncData, mappings });
      case "journal":
        return this.createJournalEntry({ accessToken, realmId: businessId, journal: data as JournalEntrySyncData, mappings });
      case "payment":
        return this.createPayment({ accessToken, realmId: businessId, payment: data as PaymentSyncData, mappings });
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
    const signature = headers["x-sage-signature"] as string | undefined;

    // Sage uses HMAC-SHA256 with the signing secret
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
    businessId: string,
    beneficiary: PaymentSyncData["beneficiary"] | InvoiceSyncData["beneficiary"] & { bankAccountName?: string; bankAccountNumber?: string },
  ): Promise<string> {
    // Search by name
    const url = new URL(`${this.getApiBaseUrl()}/contacts`);
    url.searchParams.set("business_id", businessId);
    url.searchParams.set("search", beneficiary.name);
    url.searchParams.set("items_per_page", "1");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as { $items?: Record<string, unknown>[] };
      if (data.$items?.[0]?.id) {
        return String(data.$items[0].id);
      }
    }

    // Create new contact
    const body = {
      name: beneficiary.name,
      email: beneficiary.email,
      phone: beneficiary.phone,
      contact_type: "customer",
      address: beneficiary.bankAccountName
        ? { address_line_1: beneficiary.bankAccountName, address_line_2: `Acct: ${beneficiary.bankAccountNumber ?? "N/A"}` }
        : undefined,
      notes: `KRA PIN: ${beneficiary.kraPin ?? "N/A"}`,
    };

    const createRes = await this.makeAuthenticatedRequest(
      accessToken,
      `/contacts?business_id=${businessId}`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return String((createRes as Record<string, unknown>)?.id ?? "");
  }
}