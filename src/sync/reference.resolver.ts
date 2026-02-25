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

  /* -------------------------------- CONTACT -------------------------------- */

  async resolveContact(name: string, email?: string): Promise<string> {
    // 1️⃣ Query QuickBooks
    const existing = await this.adapter.query("Customer", `DisplayName = '${this.escape(name)}'`);

    if (existing?.length) {
      return existing[0].Id;
    }

    // 2️⃣ Create if allowed
    if (this.teamSettings.autoCreateList === true) {
      const { id } = await this.adapter.createContact({ name, email });
      return id;
    }

    // 3️⃣ Fallback default
    if (!this.teamSettings.defaultContactId) {
      const { id } = await this.adapter.createContact({
        name: "BillsDeck customer",
        email: "default@example.com",
      });

      this.teamSettings.defaultContactId = id;
      await db.update(teams)
        .set({ settings: this.teamSettings })
        .where(eq(teams.id, this.organizationId));

      return id;
    }

    return this.teamSettings.defaultContactId;
  }

  /* -------------------------------- ACCOUNT -------------------------------- */

  async resolveAccount(name: string, type?: string): Promise<{ id: string; code?: string }> {
    const existing = await this.adapter.query("Account", `Name = '${this.escape(name)}'`);

    if (existing?.length) {
      return {
        id: existing[0].Id || existing[0].AccountID || existing[0].account_id,
        code: existing[0].Code || existing[0].AccountCode,
      };
    }

    if (this.teamSettings.autoCreateList === true) {
      const { id } = await this.adapter.createAccount({ name, type });
      return { id };
    }

    if (!this.teamSettings.defaultAccountId) {
      const { id } = await this.adapter.createAccount({
        name: "Uncategorized Expense",
        type: "Expense",
      });

      this.teamSettings.defaultAccountId = id;

      await db.update(teams)
        .set({ settings: this.teamSettings })
        .where(eq(teams.id, this.organizationId));

      return { id };
    }

    return { id: this.teamSettings.defaultAccountId };
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

    if (this.teamSettings.autoCreateList === true) {
      const incomeAccount = await this.resolveAccount("Services", "Income");

      const { id } = await this.adapter.createProduct({
        name,
        price,
        incomeAccountId: incomeAccount.id,
      });

      return { id };
    }

    if (!this.teamSettings.defaultProductId) {
      const incomeAccount = await this.resolveAccount("Services", "Income");

      const { id } = await this.adapter.createProduct({
        name: "Sales",
        price: 0,
        incomeAccountId: incomeAccount.id,
      });

      this.teamSettings.defaultProductId = id;

      await db.update(teams)
        .set({ settings: this.teamSettings })
        .where(eq(teams.id, this.organizationId));

      return { id };
    }

    return { id: this.teamSettings.defaultProductId };
  }

  /* ------------------------------ BANK ACCOUNT ------------------------------ */

  async resolveBankAccount(): Promise<{ id: string; code?: string }> {
    const name = this.teamSettings.defaultBankAccount || "Uncategorized Asset";
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

    this.teamSettings.defaultBankAccount = name;
    this.teamSettings.bankAccountId = id;

    await db.update(teams)
      .set({ settings: this.teamSettings })
      .where(eq(teams.id, this.organizationId));

    return { id };
  }

  /* ----------------------------- Helper: Escape ----------------------------- */

  private escape(value: string) {
    return value.replace(/'/g, "\\'");
  }
}