import { db } from "../db";
import { teams, contacts, accounts, categories, Inventory, Integrations } from "../schema";
import { eq, and } from "drizzle-orm";
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

  async resolveContact(name: string, email?: string): Promise<string> {
    const existing = await db.query.contacts.findFirst({
      where: and(
        eq(contacts.organizationId, this.organizationId),
        eq(contacts.name, name)
      ),
    });

    if (existing?.externalId) return existing.externalId;

    if (this.teamSettings.autoCreateList === true) {
      const { id } = await this.adapter.createContact({ name, email });
      if (existing) {
        await db.update(contacts).set({ externalId: id }).where(eq(contacts.id, existing.id));
      } else {
        await db.insert(contacts).values({
          id: crypto.randomUUID(),
          name,
          email,
          organizationId: this.organizationId,
          externalId: id,
          userId: "system", // default
        });
      }
      return id;
    }

    if (!this.teamSettings.defaultContactId) {
      const { id } = await this.adapter.createContact({ name: "Default Contact", email: "default@example.com" });
      this.teamSettings.defaultContactId = id;
      await db.update(teams).set({ settings: this.teamSettings }).where(eq(teams.id, this.organizationId));
      return id;
    }

    return this.teamSettings.defaultContactId;
  }

  async resolveAccount(name: string, type?: string): Promise<string> {
    const existing = await db.query.accounts.findFirst({
      where: and(
        eq(accounts.organizationId, this.organizationId),
        eq(accounts.name, name)
      ),
    });

    if (existing?.externalId) return existing.externalId;

    if (this.teamSettings.autoCreateList === true) {
      const { id } = await this.adapter.createAccount({ name, type });
      if (existing) {
        await db.update(accounts).set({ externalId: id }).where(eq(accounts.id, existing.id));
      }
      return id;
    }

    if (!this.teamSettings.defaultAccountId) {
      const { id } = await this.adapter.createAccount({ name: "Default Account", type: "Expense" });
      this.teamSettings.defaultAccountId = id;
      await db.update(teams).set({ settings: this.teamSettings }).where(eq(teams.id, this.organizationId));
      return id;
    }

    return this.teamSettings.defaultAccountId;
  }

  async resolveProduct(name: string, price: number): Promise<string> {
    const existing = await db.query.Inventory.findFirst({
      where: and(
        eq(Inventory.organizationId, this.organizationId),
        eq(Inventory.name, name)
      ),
    });

    if (existing?.externalId) return existing.externalId;

    if (this.teamSettings.autoCreateList === true) {
      const incomeAccountId = await this.resolveAccount("Sales", "Income");
      const { id } = await this.adapter.createProduct({ name, price, incomeAccountId });
      if (existing) {
        await db.update(Inventory).set({ externalId: id }).where(eq(Inventory.id, existing.id));
      }
      return id;
    }

    // Default missing logic
    if (!this.teamSettings.defaultProductId) {
      const { id } = await this.adapter.createProduct({ name: "Default Product", price: 0, incomeAccountId: "DEFAULT_ACCOUNT" });
      this.teamSettings.defaultProductId = id;
      await db.update(teams).set({ settings: this.teamSettings }).where(eq(teams.id, this.organizationId));
      return id;
    }

    return this.teamSettings.defaultProductId;
  }
}
