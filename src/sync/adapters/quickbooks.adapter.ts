import { db } from "../../db";
import { Integrations } from "../../schema";
import { eq } from "drizzle-orm";
import { AccountingAdapter, CreateTransactionResponse } from "./accounting.adapter";
import logger from "../../utils/logger";
import axios from "axios";

export class QuickBooksAdapter implements AccountingAdapter {
  private integration: any;
  private apiBaseUrl: string;
  private refreshPromise: Promise<void> | null = null;

  constructor(integration: any) {
    this.integration = integration;
    this.apiBaseUrl = process.env.QUICKBOOKS_API_URL || "https://sandbox-quickbooks.api.intuit.com";
  }

  private isTokenExpired(integrationData: any = this.integration): boolean {
    if (!integrationData.expiresAt) {
      logger.warn({ integrationId: integrationData.id }, "Token expiry date not set");
      return true;
    }

    const expiryTime = new Date(integrationData.expiresAt).getTime();
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minute buffer

    const isExpired = now > (expiryTime - bufferTime);

    if (isExpired) {
      logger.info({
        integrationId: integrationData.id,
        expiresAt: integrationData.expiresAt,
        bufferMinutes: 5
      }, "Token is expired or expiring soon");
    }

    return isExpired;
  }

  private async ensureValidToken(): Promise<void> {
    // 1. Initial memory check
    if (!this.isTokenExpired()) {
      return;
    }

    // 2. Lock to prevent concurrent refresh in SAME process
    if (this.refreshPromise) {
      logger.info({ integrationId: this.integration.id }, "Waiting for existing token refresh in progress");
      await this.refreshPromise;
      return;
    }

    // 3. Create refresh promise
    this.refreshPromise = (async () => {
      try {
        // 4. Fetch latest from DB to check if ANOTHER process refreshed it
        const latestIntegration = await db.query.Integrations.findFirst({
          where: eq(Integrations.id, this.integration.id),
        });

        if (latestIntegration) {
          this.integration = latestIntegration; // Update memory with latest DB data

          // Check if DB already has a valid token now
          if (!this.isTokenExpired(latestIntegration)) {
            logger.info({ integrationId: this.integration.id }, "Token was refreshed by another process, skipping");
            return;
          }
        }

        // 5. Perform the actual refresh if still expired
        await this.refreshToken();
      } finally {
        this.refreshPromise = null;
      }
    })();

    await this.refreshPromise;
  }

  async refreshToken(): Promise<void> {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

    logger.info({ integrationId: this.integration.id, clientId: clientId, clientSecret: clientSecret, provider: "quickbooks" }, "Attempting to refresh QuickBooks token");

    try {
      const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      const res = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.integration.refreshToken,
        }),
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const data = res.data;

      this.integration.accessToken = data.access_token;
      this.integration.refreshToken = data.refresh_token || this.integration.refreshToken;
      this.integration.expiresAt = new Date(Date.now() + data.expires_in * 1000);
      this.integration.tokenType = data.token_type || this.integration.tokenType;
      this.integration.scope = data.scope || this.integration.scope;

      await db.update(Integrations).set({
        accessToken: this.integration.accessToken,
        refreshToken: this.integration.refreshToken,
        expiresAt: this.integration.expiresAt,
        tokenType: this.integration.tokenType,
        scope: this.integration.scope,
        metadata: { ...this.integration.metadata, authStatus: "active" },
        updatedAt: new Date(),
      }).where(eq(Integrations.id, this.integration.id));

      logger.info({ integrationId: this.integration.id, expiresAt: this.integration.expiresAt }, "QuickBooks token refreshed successfully");
    } catch (error: any) {
      const errorData = error.response?.data || {};
      logger.error({
        integrationId: this.integration.id,
        error: errorData.error || error.message,
        errorDescription: errorData.error_description,
        statusCode: error.response?.status
      }, "QuickBooks token refresh failed");

      if (errorData.error === "invalid_grant") {
        await db.update(Integrations).set({
          metadata: { ...this.integration.metadata, authStatus: "expired", lastAuthError: errorData.error_description },
          updatedAt: new Date(),
        }).where(eq(Integrations.id, this.integration.id));

        throw new Error(`QB Token Expired or Revoked: ${errorData.error_description || errorData.error}. Re-authentication required.`);
      }

      throw new Error(`QB Refresh Failed: ${errorData.error || error.message}`);
    }
  }

  private async fetchWithToken(endpoint: string, options: any = {}): Promise<any> {
    await this.ensureValidToken();

    try {
      const res = await axios({
        url: `${this.apiBaseUrl}${endpoint}`,
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${this.integration.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      return res.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        logger.warn({
          integrationId: this.integration.id,
          endpoint,
          statusCode: 401
        }, "Received 401 despite token validation, attempting force refresh");

        // Force expiration in memory to trigger a new refresh
        this.integration.expiresAt = new Date(Date.now() - 1000);
        await this.ensureValidToken();

        // Retry once with new token
        const retryRes = await axios({
          url: `${this.apiBaseUrl}${endpoint}`,
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${this.integration.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });
        return retryRes.data;
      }

      const errorData = error.response?.data || {};
      throw new Error(`QB API Error: ${JSON.stringify(errorData)}`);
    }
  }

  async createContact(data: any): Promise<{ id: string }> {
    logger.info({ data }, "Creating contact for quickbooks")
    const payload = {
      DisplayName: data.name,
      PrimaryEmailAddr: data.email ? { Address: data.email } : undefined,
    };
    const type = data.type === 'customer' ? 'customer' : 'vendor';
    logger.info({ type, payload, realmid: this.integration.realmId }, "getting payload and type")
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/${type}`, {
      method: "POST",
      data: payload,
    });
    logger.info({ response }, "Quickbooks contact creation completed")

    const entityName = type.charAt(0).toUpperCase() + type.slice(1);
    const entity = response[entityName];

    if (!entity || !entity.Id) {
      logger.error({ response, entityName }, "QuickBooks contact creation response missing entity data");
      throw new Error(`QuickBooks contact creation failed: Response missing ${entityName} data`);
    }

    return { id: entity.Id };
  }

  async createProduct(data: any): Promise<{ id: string }> {
    logger.info({ data }, "Creating product for quickbooks")
    const payload = {
      Name: data.name,
      Type: "Service",
      IncomeAccountRef: { value: data.incomeAccountId },
      ExpenseAccountRef: { value: data.expenseAccountId },
    };
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/item`, {
      method: "POST",
      data: payload,
    });

    if (!response.Item || !response.Item.Id) {
      logger.error({ response }, "QuickBooks product creation response missing Item data");
      throw new Error("QuickBooks product creation failed: Response missing Item data");
    }

    return { id: response.Item.Id };
  }

  async createExpense(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/purchase`, {
      method: "POST",
      data: payload,
    });

    if (!response.Purchase || !response.Purchase.Id) {
      logger.error({ response }, "QuickBooks expense creation response missing Purchase data");
      throw new Error("QuickBooks expense creation failed: Response missing Purchase data");
    }

    return {
      id: response.Purchase.Id,
      ...response.Purchase
    };
  }

  async createInvoice(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/invoice`, {
      method: "POST",
      data: payload,
    });

    if (!response.Invoice || !response.Invoice.Id) {
      logger.error({ response }, "QuickBooks invoice creation response missing Invoice data");
      throw new Error("QuickBooks invoice creation failed: Response missing Invoice data");
    }

    return {
      id: response.Invoice.Id,
      ...response.Invoice
    };
  }

  async createSalesReceipt(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/salesreceipt`, {
      method: "POST",
      data: payload,
    });

    if (!response.SalesReceipt || !response.SalesReceipt.Id) {
      logger.error({ response }, "QuickBooks sales receipt creation response missing SalesReceipt data");
      throw new Error("QuickBooks sales receipt creation failed: Response missing SalesReceipt data");
    }

    return {
      id: response.SalesReceipt.Id,
      ...response.SalesReceipt
    };
  }

  async createPayment(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/payment`, {
      method: "POST",
      data: payload,
    });

    if (!response.Payment || !response.Payment.Id) {
      logger.error({ response }, "QuickBooks payment creation response missing Payment data");
      throw new Error("QuickBooks payment creation failed: Response missing Payment data");
    }

    return {
      id: response.Payment.Id,
      ...response.Payment
    };
  }

  async createJournalEntry(payload: any): Promise<CreateTransactionResponse> {
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/journalentry`, {
      method: "POST",
      data: payload,
    });

    if (!response.JournalEntry || !response.JournalEntry.Id) {
      logger.error({ response }, "QuickBooks journal entry creation response missing JournalEntry data");
      throw new Error("QuickBooks journal entry creation failed: Response missing JournalEntry data");
    }

    return {
      id: response.JournalEntry.Id,
      ...response.JournalEntry
    };
  }

  async createAccount(data: any): Promise<{ id: string }> {
    const payload = {
      Name: data.name,
      AccountType: data.type || "Expense",
      AccountSubType: data.subType,
    };
    const response = await this.fetchWithToken(`/v3/company/${this.integration.realmId}/account`, {
      method: "POST",
      data: payload,
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
