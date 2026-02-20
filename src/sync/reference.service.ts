import { db } from "../db";
import { accounts, contacts, Inventory, teams, Integrations } from "../schema";
import { eq, and, sql } from "drizzle-orm";
import { AccountingAdapter } from "./adapters/accounting.adapter";
import { QuickBooksAdapter } from "./adapters/quickbooks.adapter";
import { XeroAdapter } from "./adapters/xero.adapter";
import { ZohoAdapter } from "./adapters/zoho.adapter";

export class ReferenceDataService {
  async syncAllReferences(organizationId: number, provider: string) {
    const integration = await db.query.Integrations.findFirst({
      where: and(eq(Integrations.organizationId, organizationId), eq(Integrations.provider, provider)),
    });
    if (!integration) return;

    const adapter = this.getAdapter(provider, integration);
    
    // Step 1: Immediate Sync
    await this.syncAccounts(organizationId, adapter);
    await this.syncTaxRates(organizationId, adapter);
    
    // Step 2: Lazy Sync (can be triggered manually)
    // await this.syncContacts(organizationId, adapter);
    // await this.syncProducts(organizationId, adapter);
  }

  async syncAccounts(organizationId: number, adapter: AccountingAdapter) {
    const externalAccounts = await adapter.fetchAccounts();
    for (const acc of externalAccounts) {
      await db.insert(accounts).values({
        id: crypto.randomUUID(),
        name: acc.Name || acc.name,
        externalId: acc.Id || acc.AccountID || acc.account_id,
        type: acc.AccountType || acc.Type || acc.account_type,
        userId: "system",
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: accounts.id, // Assuming externalId or id conflict logic
        set: { name: acc.Name || acc.name, type: acc.AccountType || acc.Type || acc.account_type, updatedAt: new Date() }
      });
    }
  }

  async syncTaxRates(organizationId: number, adapter: AccountingAdapter) {
    // Similar logic for tax rates if table existed
  }

  async syncContacts(organizationId: number, adapter: AccountingAdapter, lastUpdated?: Date) {
    const externalContacts = await adapter.fetchContacts(undefined, lastUpdated);
    for (const contact of externalContacts) {
      const extId = contact.Id || contact.ContactID || contact.contact_id;
      await db.insert(contacts).values({
        id: crypto.randomUUID(),
        name: contact.DisplayName || contact.Name || contact.contact_name,
        externalId: extId,
        email: contact.PrimaryEmailAddr?.Address || contact.EmailAddress || contact.email,
        organizationId,
        userId: "system",
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: contacts.id,
        set: { name: contact.DisplayName || contact.Name || contact.contact_name, updatedAt: new Date() }
      });
    }
  }

  async syncProducts(organizationId: number, adapter: AccountingAdapter, lastUpdated?: Date) {
    const externalProducts = await adapter.fetchProducts(lastUpdated);
    for (const prod of externalProducts) {
      await db.insert(Inventory).values({
        name: prod.Name || prod.name,
        externalId: prod.Id || prod.ItemID || prod.item_id,
        price: (prod.UnitPrice || prod.rate || 0).toString(),
        organizationId,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: Inventory.id,
        set: { name: prod.Name || prod.name, updatedAt: new Date() }
      });
    }
  }

  private getAdapter(platform: string, integration: any): AccountingAdapter {
    switch (platform.toLowerCase()) {
      case "quickbooks": return new QuickBooksAdapter(integration);
      case "xero": return new XeroAdapter(integration);
      case "zoho":
      case "zohobooks": return new ZohoAdapter(integration);
      default: throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
