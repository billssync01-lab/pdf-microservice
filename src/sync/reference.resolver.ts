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

  async resolveAccount(name: string, type?: string): Promise<string> {
    const existing = await this.adapter.query("Account", `Name = '${this.escape(name)}'`);

    if (existing?.length) {
      return existing[0].Id;
    }

    if (this.teamSettings.autoCreateList === true) {
      const { id } = await this.adapter.createAccount({ name, type });
      return id;
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

      return id;
    }

    return this.teamSettings.defaultAccountId;
  }

  /* -------------------------------- PRODUCT -------------------------------- */

  async resolveProduct(name: string, price: number): Promise<string> {
    const existing = await this.adapter.query("Item", `Name = '${this.escape(name)}'`);

    if (existing?.length) {
      return existing[0].Id;
    }

    if (this.teamSettings.autoCreateList === true) {
      const incomeAccountId = await this.resolveAccount("Services", "Income");

      const { id } = await this.adapter.createProduct({
        name,
        price,
        incomeAccountId,
      });

      return id;
    }

    if (!this.teamSettings.defaultProductId) {
      const incomeAccountId = await this.resolveAccount("Services", "Income");

      const { id } = await this.adapter.createProduct({
        name: "Sales",
        price: 0,
        incomeAccountId,
      });

      this.teamSettings.defaultProductId = id;

      await db.update(teams)
        .set({ settings: this.teamSettings })
        .where(eq(teams.id, this.organizationId));

      return id;
    }

    return this.teamSettings.defaultProductId;
  }

  /* ----------------------------- Helper: Escape ----------------------------- */

  private escape(value: string) {
    return value.replace(/'/g, "\\'");
  }
}