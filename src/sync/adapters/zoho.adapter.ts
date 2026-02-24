import { db } from "../../db";
import { Integrations } from "../../schema";
import { eq } from "drizzle-orm";
import { AccountingAdapter, CreateTransactionResponse } from "./accounting.adapter";

export class ZohoAdapter implements AccountingAdapter {
  private integration: any;
  private apiBaseUrl: string;

  constructor(integration: any) {
    this.integration = integration;
    this.apiBaseUrl = this.integration.metadata?.region === "IN" ? "https://books.zoho.in/api/v3" : "https://books.zoho.com/api/v3";
  }

  async refreshToken(): Promise<void> {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const region = this.integration.metadata?.region || "COM";
    const tokenUrl = region === "IN" ? "https://accounts.zoho.in/oauth/v2/token" : "https://accounts.zoho.com/oauth/v2/token";

    const res = await fetch(tokenUrl, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.integration.refreshToken,
        client_id: clientId || "",
        client_secret: clientSecret || "",
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Zoho Refresh Failed: ${data.error}`);

    this.integration.accessToken = data.access_token;
    this.integration.expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await db.update(Integrations).set({
      accessToken: this.integration.accessToken,
      expiresAt: this.integration.expiresAt,
      updatedAt: new Date(),
    }).where(eq(Integrations.id, this.integration.id));
  }

  private async fetchWithToken(endpoint: string, options: any = {}): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}${endpoint}${endpoint.includes("?") ? "&" : "?"}organization_id=${this.integration.orgId}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Zoho-oauthtoken ${this.integration.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (res.status === 401) {
      await this.refreshToken();
      return this.fetchWithToken(endpoint, options);
    }

    const data = await res.json();
    if (!res.ok) throw new Error(`Zoho API Error: ${JSON.stringify(data)}`);
    return data;
  }

  async createContact(data: any): Promise<{ id: string }> {
    const payload = {
      contact_name: data.name,
      contact_type: data.type || "vendor",
      email: data.email,
    };
    const response = await this.fetchWithToken("/contacts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    if (!response.contact || !response.contact.contact_id) {
      throw new Error("Zoho contact creation failed: Response missing contact_id");
    }
    
    return { id: response.contact.contact_id };
  }

  async createProduct(data: any): Promise<{ id: string }> {
    const payload = {
      name: data.name,
      rate: data.price,
      item_type: "service",
    };
    const response = await this.fetchWithToken("/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    if (!response.item || !response.item.item_id) {
      throw new Error("Zoho product creation failed: Response missing item_id");
    }
    
    return { id: response.item.item_id };
  }

  async createExpense(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken("/expenses", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    if (!response.expense || !response.expense.expense_id) {
      throw new Error("Zoho expense creation failed: Response missing expense_id");
    }
    
    return { 
      id: response.expense.expense_id,
      ...response.expense
    };
  }

  async createInvoice(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken("/invoices", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    if (!response.invoice || !response.invoice.invoice_id) {
      throw new Error("Zoho invoice creation failed: Response missing invoice_id");
    }
    
    return { 
      id: response.invoice.invoice_id,
      ...response.invoice
    };
  }

  async createSalesReceipt(payload: any): Promise<CreateTransactionResponse> {
    // Zoho uses invoices with payments or specific sales receipts
    return this.createInvoice(payload);
  }

  async createPayment(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken("/customerpayments", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    if (!response.payment || !response.payment.payment_id) {
      throw new Error("Zoho payment creation failed: Response missing payment_id");
    }
    
    return { 
      id: response.payment.payment_id,
      ...response.payment
    };
  }

  async createJournalEntry(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken("/journals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    if (!response.journal || !response.journal.journal_id) {
      throw new Error("Zoho journal creation failed: Response missing journal_id");
    }
    
    return { 
      id: response.journal.journal_id,
      ...response.journal
    };
  }

  async createAccount(data: any): Promise<{ id: string }> {
    const payload = {
      account_name: data.name,
      account_type: data.type || "expense",
    };
    const response = await this.fetchWithToken("/chartofaccounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { id: response.account.account_id };
  }

  async createTaxRate(data: any): Promise<{ id: string }> {
    const response = await this.fetchWithToken("/settings/taxes", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { id: response.tax.tax_id };
  }

  async fetchAccounts(): Promise<any[]> {
    const response = await this.fetchWithToken("/chartofaccounts");
    return response.chartofaccounts || [];
  }

  async fetchTaxRates(): Promise<any[]> {
    const response = await this.fetchWithToken("/settings/taxes");
    return response.taxes || [];
  }

  async fetchContacts(type?: 'customer' | 'vendor', lastUpdated?: Date): Promise<any[]> {
    let url = "/contacts";
    if (lastUpdated) {
      url += `?last_modified_time=${lastUpdated.toISOString()}`;
    }
    const response = await this.fetchWithToken(url);
    return response.contacts || [];
  }

  async fetchProducts(lastUpdated?: Date): Promise<any[]> {
    let url = "/items";
    if (lastUpdated) {
      url += `?last_modified_time=${lastUpdated.toISOString()}`;
    }
    const response = await this.fetchWithToken(url);
    return response.items || [];
  }
}
