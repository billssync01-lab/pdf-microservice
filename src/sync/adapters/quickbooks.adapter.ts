import { db } from "../../db";
import { Integrations } from "../../schema";
import { eq } from "drizzle-orm";
import { AccountingAdapter } from "./accounting.adapter";
import logger from "../../utils/logger";

export class QuickBooksAdapter implements AccountingAdapter {
  private integration: any;
  private apiBaseUrl: string;

  constructor(integration: any) {
    this.integration = integration;
    this.apiBaseUrl = process.env.QUICKBOOKS_API_URL || "https://sandbox-quickbooks.api.intuit.com";
  }

  async refreshToken(): Promise<void> {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.integration.refreshToken,
      }),
    });

    const data = await res.json();
    logger.info({ res }, "Quickbooks refresh failed")
    if (!res.ok) throw new Error(`QB Refresh Failed: ${data.error}`);

    this.integration.accessToken = data.access_token;
    this.integration.refreshToken = data.refresh_token || this.integration.refreshToken;
    this.integration.expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await db.update(Integrations).set({
      accessToken: this.integration.accessToken,
      refreshToken: this.integration.refreshToken,
      expiresAt: this.integration.expiresAt,
      updatedAt: new Date(),
    }).where(eq(Integrations.id, this.integration.id));
    logger.info("Integration Updated")

  }

  private async fetchWithToken(endpoint: string, options: any = {}): Promise<any> {
    // ... same as before but uses this.integration.accessToken
    const res = await fetch(`${this.apiBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.integration.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (res.status === 401) {
      await this.refreshToken();
      return this.fetchWithToken(endpoint, options);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(`QB API Error: ${JSON.stringify(data)}`);
    return data;
  }

  async createContact(data: any): Promise<{ id: string }> {
    logger.info({ data }, "Creating contact for quickbooks")
    const payload = {
      DisplayName: data.name,
      PrimaryEmailAddr: data.email ? { Address: data.email } : undefined,
    };
    const type = data.type === 'customer' ? 'customer' : 'vendor';
    logger.info({ type, payload }, "getting payload and type")
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/${type}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    logger.info({ response }, "Quickbooks contact creation completed")
    return { id: response[type.charAt(0).toUpperCase() + type.slice(1)].Id };
  }

  async createProduct(data: any): Promise<{ id: string }> {
    logger.info({ data }, "Creating contact for quickbooks")
    const payload = {
      Name: data.name,
      Type: "Service",
      IncomeAccountRef: { value: data.incomeAccountId },
      ExpenseAccountRef: { value: data.expenseAccountId },
    };
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/item`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Item.Id };
  }

  async createExpense(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/purchase`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Purchase.Id };
  }

  async createInvoice(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/invoice`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Invoice.Id };
  }

  async createSalesReceipt(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/salesreceipt`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.SalesReceipt.Id };
  }

  async createPayment(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/payment`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Payment.Id };
  }

  async createJournalEntry(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/journalentry`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.JournalEntry.Id };
  }

  async createAccount(data: any): Promise<{ id: string }> {
    const payload = {
      Name: data.name,
      AccountType: data.type || "Expense",
      AccountSubType: data.subType,
    };
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/account`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Account.Id };
  }

  async createTaxRate(data: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/taxservice/taxcode`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { id: response.TaxCodeId };
  }

  async fetchAccounts(): Promise<any[]> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/query?query=select * from Account maxresults 500`);
    return response.QueryResponse.Account || [];
  }

  async fetchTaxRates(): Promise<any[]> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/query?query=select * from TaxCode maxresults 500`);
    return response.QueryResponse.TaxCode || [];
  }

  async fetchContacts(type: 'customer' | 'vendor' = 'vendor', lastUpdated?: Date): Promise<any[]> {
    const table = type === 'customer' ? 'Customer' : 'Vendor';
    let query = `select * from ${table}`;
    if (lastUpdated) {
      query += ` where Metadata.LastUpdatedTime > '${lastUpdated.toISOString()}'`;
    }
    query += ` maxresults 500`;
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/query?query=${encodeURIComponent(query)}`);
    return response.QueryResponse[table] || [];
  }

  async fetchProducts(lastUpdated?: Date): Promise<any[]> {
    let query = `select * from Item`;
    if (lastUpdated) {
      query += ` where Metadata.LastUpdatedTime > '${lastUpdated.toISOString()}'`;
    }
    query += ` maxresults 500`;
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/query?query=${encodeURIComponent(query)}`);
    return response.QueryResponse.Item || [];
  }
}
