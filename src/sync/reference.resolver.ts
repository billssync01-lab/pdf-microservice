import { db } from "../db";
import { teams } from "../schema";
import { eq } from "drizzle-orm";
import { AccountingAdapter } from "./adapters/accounting.adapter";

export class ReferenceResolver {
  private adapter: AccountingAdapter;
  private organizationId: number;
  private teamSettings: any;

  constructor(adapter: AccountingAdapter, organizationId: number, teamSettings: any) {
    this.adapter = adapter;
    this.organizationId = organizationId;
    this.teamSettings = teamSettings;
  }

  /**
   * Helper to detect the platform key (qbo, xero, zoho) from the adapter
   */
  private getPlatformKey(): "qbo" | "xero" | "zoho" {
    const className = this.adapter.constructor.name;
    if (className.includes("QuickBooks")) return "qbo";
    if (className.includes("Xero")) return "xero";
    if (className.includes("Zoho")) return "zoho";
    return "qbo";
  }

  /**
   * Helper to get a generic accounting setting value
   */
  private getSetting(group: string, key: string): any {
    return this.teamSettings[group]?.[key]?.value;
  }

  /**
   * Helper to update settings in the database
   */
  private async updateSettings() {
    await db.update(teams)
      .set({ settings: this.teamSettings })
      .where(eq(teams.id, this.organizationId));
  }

  /* -------------------------------- CONTACT -------------------------------- */

  async resolveContact(name: string, email?: string): Promise<string> {
    // 1️⃣ Try to find existing contact by name
    const existing = await this.adapter.query("Customer", `DisplayName = '${this.escape(name)}'`);
    if (existing?.length) {
      return existing[0].Id;
    }

    // 2️⃣ Create if auto-creation is enabled
    if (this.getSetting("accounting", "autoCreateList") === true) {
      const { id } = await this.adapter.createContact({ name, email });
      return id;
    }

    // 3️⃣ Fallback to default supplier name from settings
    const platform = this.getPlatformKey();
    const fallbackName = this.teamSettings.integrations?.[platform]?.defaultSupplier?.value || "BillsDeck customer";

    const existingFallback = await this.adapter.query("Customer", `DisplayName = '${this.escape(fallbackName)}'`);
    if (existingFallback?.length) {
      return existingFallback[0].Id;
    }

    // Create fallback if it doesn't exist
    const { id } = await this.adapter.createContact({
      name: fallbackName,
      email: "default@example.com",
    });

    // If the setting was empty, save the hardcoded default back to DB
    if (!this.teamSettings.integrations?.[platform]?.defaultSupplier?.value) {
      if (!this.teamSettings.integrations) this.teamSettings.integrations = {};
      if (!this.teamSettings.integrations[platform]) this.teamSettings.integrations[platform] = {};
      this.teamSettings.integrations[platform].defaultSupplier = { label: "Default Supplier", value: fallbackName };
      await this.updateSettings();
    }

    return id;
  }

  /* -------------------------------- ACCOUNT -------------------------------- */

  async resolveAccount(name: string, type?: string): Promise<{ id: string; code?: string }> {
    // 1️⃣ Try to find existing account by name
    const existing = await this.adapter.query("Account", `Name = '${this.escape(name)}'`);
    if (existing?.length) {
      return {
        id: existing[0].Id || existing[0].AccountID || existing[0].account_id,
        code: existing[0].Code || existing[0].AccountCode,
      };
    }

    // 2️⃣ Create if auto-creation is enabled
    if (this.getSetting("accounting", "autoCreateList") === true) {
      const { id } = await this.adapter.createAccount({ name, type });
      return { id };
    }

    // 3️⃣ Fallback to default account name from settings
    const platform = this.getPlatformKey();
    const isIncome = type === "Income";
    const settingKey = isIncome 
      ? (platform === "qbo" ? "defaultIncomeAccount" : "defaultRevenueAccount") 
      : "defaultExpenseAccount";
    
    const fallbackName = this.teamSettings.integrations?.[platform]?.[settingKey]?.value || 
      (isIncome ? "Sales" : "Uncategorized Expense");

    const existingFallback = await this.adapter.query("Account", `Name = '${this.escape(fallbackName)}'`);
    if (existingFallback?.length) {
      return {
        id: existingFallback[0].Id || existingFallback[0].AccountID || existingFallback[0].account_id,
        code: existingFallback[0].Code || existingFallback[0].AccountCode,
      };
    }

    // Create fallback account
    const { id } = await this.adapter.createAccount({
      name: fallbackName,
      type: type || "Expense",
    });

    // Save default name if setting was empty
    if (!this.teamSettings.integrations?.[platform]?.[settingKey]?.value) {
      if (!this.teamSettings.integrations) this.teamSettings.integrations = {};
      if (!this.teamSettings.integrations[platform]) this.teamSettings.integrations[platform] = {};
      this.teamSettings.integrations[platform][settingKey] = { 
        label: isIncome ? "Income Account" : "Expense Account", 
        value: fallbackName 
      };
      await this.updateSettings();
    }

    return { id };
  }

  /* -------------------------------- PRODUCT -------------------------------- */

  async resolveProduct(name: string, price: number): Promise<{ id: string; code?: string }> {
    const existing = await this.adapter.query("Item", `Name = '${this.escape(name)}'`);
    if (existing?.length) {
      return {
        id: existing[0].Id || existing[0].ItemID || existing[0].item_id,
        code: existing[0].Code || existing[0].ItemCode,
      };
    }

    if (this.getSetting("accounting", "autoCreateList") === true) {
      const incomeAccount = await this.resolveAccount("Services", "Income");
      const { id } = await this.adapter.createProduct({
        name,
        price,
        incomeAccountId: incomeAccount.id,
      });
      return { id };
    }

    // Generic fallback for products
    const fallbackName = "Sales";
    const existingFallback = await this.adapter.query("Item", `Name = '${this.escape(fallbackName)}'`);
    if (existingFallback?.length) {
      return {
        id: existingFallback[0].Id || existingFallback[0].ItemID || existingFallback[0].item_id,
        code: existingFallback[0].Code || existingFallback[0].ItemCode,
      };
    }

    const incomeAccount = await this.resolveAccount("Services", "Income");
    const { id } = await this.adapter.createProduct({
      name: fallbackName,
      price: 0,
      incomeAccountId: incomeAccount.id,
    });

    return { id };
  }

  /* ------------------------------ BANK ACCOUNT ------------------------------ */

  async resolveBankAccount(): Promise<{ id: string; code?: string }> {
    const platform = this.getPlatformKey();
    const name = this.teamSettings.integrations?.[platform]?.defaultBankAccount?.value || "Uncategorized Asset";
    
    const existing = await this.adapter.query("Account", `Name = '${this.escape(name)}'`);
    if (existing?.length) {
      return {
        id: existing[0].Id || existing[0].AccountID || existing[0].account_id,
        code: existing[0].Code || existing[0].AccountCode,
      };
    }

    const { id } = await this.adapter.createAccount({
      name,
      type: "Bank",
    });

    // Save default bank name if setting was empty
    if (!this.teamSettings.integrations?.[platform]?.defaultBankAccount?.value) {
      if (!this.teamSettings.integrations) this.teamSettings.integrations = {};
      if (!this.teamSettings.integrations[platform]) this.teamSettings.integrations[platform] = {};
      this.teamSettings.integrations[platform].defaultBankAccount = { label: "Bank Account", value: name };
      await this.updateSettings();
    }

    return { id };
  }

  /* ----------------------------- Helper: Escape ----------------------------- */

  private escape(value: string) {
    return value.replace(/'/g, "\\'");
  }
}
