import { db } from "../../db";
import { Integrations } from "../../schema";
import { eq } from "drizzle-orm";
import { AccountingAdapter } from "./accounting.adapter";

export class XeroAdapter implements AccountingAdapter {
  private integration: any;
  private apiBaseUrl: string = "https://api.xero.com/api.xro/2.0";

  constructor(integration: any) {
    this.integration = integration;
  }

  async refreshToken(): Promise<void> {
    const clientId = process.env.XERO_CLIENT_ID;
    const clientSecret = process.env.XERO_CLIENT_SECRET;
    const tokenUrl = "https://identity.xero.com/connect/token";

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
    if (!res.ok) throw new Error(`Xero Refresh Failed: ${data.error}`);

    this.integration.accessToken = data.access_token;
    this.integration.refreshToken = data.refresh_token || this.integration.refreshToken;
    this.integration.expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await db.update(Integrations).set({
      accessToken: this.integration.accessToken,
      refreshToken: this.integration.refreshToken,
      expiresAt: this.integration.expiresAt,
      updatedAt: new Date(),
    }).where(eq(Integrations.id, this.integration.id));
  }

  private async fetchWithToken(endpoint: string, options: any = {}): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.integration.accessToken}`,
        "Xero-Tenant-Id": this.integration.tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (res.status === 401) {
      await this.refreshToken();
      return this.fetchWithToken(endpoint, options);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(`Xero API Error: ${JSON.stringify(data)}`);
    return data;
  }

  async createContact(data: any): Promise<{ id: string }> {
    const payload = {
      Contacts: [{ Name: data.name, EmailAddress: data.email }],
    };
    const response = await this.fetchWithToken("/Contacts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Contacts[0].ContactID };
  }

  async createProduct(data: any): Promise<{ id: string }> {
    const payload = {
      Items: [{ Code: data.sku || data.name, Name: data.name }],
    };
    const response = await this.fetchWithToken("/Items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Items[0].ItemID };
  }

  async createExpense(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken("/Invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Invoices[0].InvoiceID };
  }

  async createInvoice(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken("/Invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Invoices[0].InvoiceID };
  }

  async createPayment(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken("/Payments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Payments[0].PaymentID };
  }

  async createJournalEntry(payload: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken("/ManualJournals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.ManualJournals[0].ManualJournalID };
  }

  async createAccount(data: any): Promise<{ id: string }> {
    const payload = {
      Code: data.code,
      Name: data.name,
      Type: data.type || "EXPENSE",
    };
    const response = await this.fetchWithToken("/Accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.Accounts[0].AccountID };
  }

  async createTaxRate(data: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken("/TaxRates", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { id: response.TaxRates[0].Name };
  }

  async fetchAccounts(): Promise<any[]> {
    const response = await this.fetchWithToken("/Accounts");
    return response.Accounts || [];
  }

  async fetchTaxRates(): Promise<any[]> {
    const response = await this.fetchWithToken("/TaxRates");
    return response.TaxRates || [];
  }

  async fetchContacts(type?: 'customer' | 'vendor', lastUpdated?: Date): Promise<any[]> {
    let url = "/Contacts";
    const params = new URLSearchParams();
    if (lastUpdated) {
      // Xero uses If-Modified-Since header usually, but we can try Where clause
      params.append("where", `UpdatedDateUTC >= DateTime(${lastUpdated.toISOString().split('.')[0]})`);
    }
    const response = await this.fetchWithToken(`${url}?${params.toString()}`);
    return response.Contacts || [];
  }

  async fetchProducts(lastUpdated?: Date): Promise<any[]> {
    const response = await this.fetchWithToken("/Items");
    return response.Items || [];
  }
}
