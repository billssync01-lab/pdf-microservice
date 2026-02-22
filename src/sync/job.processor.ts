import { db } from "../db";
import { SyncJobs, SyncJobItems, transactions, transactionLineItems, teams, Integrations } from "../schema";
import { eq, and } from "drizzle-orm";
import { QuickBooksAdapter } from "./adapters/quickbooks.adapter";
import { XeroAdapter } from "./adapters/xero.adapter";
import { ZohoAdapter } from "./adapters/zoho.adapter";
import { ReferenceResolver } from "./reference.resolver";
import { PayloadBuilder } from "./payload.builder";
import { AccountingAdapter } from "./adapters/accounting.adapter";
import logger from "../utils/logger";

export class JobProcessor {
  private teamSettings: any;

  async processJob(jobId: string) {
    const job = await db.query.SyncJobs.findFirst({
      where: eq(SyncJobs.id, jobId),
    });

    if (!job) throw new Error("Job not found");

    await db.update(SyncJobs).set({ status: "processing", startedAt: new Date() }).where(eq(SyncJobs.id, jobId));

    try {
      const team = await db.query.teams.findFirst({
        where: eq(teams.id, job.organizationId),
      });

      this.teamSettings = team?.settings || {};

      const integration = await db.query.Integrations.findFirst({
        where: and(
          eq(Integrations.organizationId, job.organizationId),
          eq(Integrations.provider, (job.payload as any).platform)
        ),
      });

      if (!integration) {
        await db.update(SyncJobs).set({ status: "error", error: "Integration not found", completedAt: new Date() }).where(eq(SyncJobs.id, jobId));
        throw new Error("Integration not found");
      }

      const adapter = this.getAdapter((job.payload as any).platform, integration);
      const resolver = new ReferenceResolver(adapter, job.organizationId, team?.settings || {});

      const items = await db.query.SyncJobItems.findMany({
        where: eq(SyncJobItems.jobId, jobId),
      });

      let completed = 0;
      for (const item of items) {
        try {
          await this.processItem(item, adapter, resolver, (job.payload as any).platform);
          completed++;
          await db.update(SyncJobs).set({
            progress: Math.round((completed / items.length) * 100),
            successCount: completed
          }).where(eq(SyncJobs.id, jobId));
        } catch (error: any) {
          logger.info({ jobId, error }, `Item ${item.id} failed:`);
          await db.update(SyncJobItems).set({ status: "failed", error: error.message }).where(eq(SyncJobItems.id, item.id));
          await db.update(SyncJobs).set({ status: "failed", completedAt: new Date() }).where(eq(SyncJobs.id, jobId));
          return;
        }
      }

      await db.update(SyncJobs).set({ status: "completed", completedAt: new Date() }).where(eq(SyncJobs.id, jobId));
    } catch (error: any) {
      logger.info({ jobId, error }, `Job ${jobId} failed:`);
      await db.update(SyncJobs).set({ status: "failed", error: error.message }).where(eq(SyncJobs.id, jobId));
    }
  }

  private async processItem(item: any, adapter: AccountingAdapter, resolver: ReferenceResolver, platform: string) {
    await db.update(SyncJobItems).set({ status: "processing" }).where(eq(SyncJobItems.id, item.id));

    const transaction = await db.query.transactions.findFirst({
      where: eq(transactions.id, item.referenceId),
    });

    if (!transaction) throw new Error("Transaction not found");

    const lineItems = await db.query.transactionLineItems.findMany({
      where: eq(transactionLineItems.transactionId, transaction.id),
    });

    // Resolve References
    const contactId = await resolver.resolveContact(transaction.payee);
    const accountId = await resolver.resolveAccount("General Expense"); // Simplified

    const references = { contactId, accountId };
    const payload = PayloadBuilder.build(platform, transaction, lineItems, references, this.teamSettings);

    let result;
    if (transaction.type === 'expense') {
      result = await adapter.createExpense!(payload);
    } else {
      result = await adapter.createInvoice!(payload);
    }

    await db.update(SyncJobItems).set({
      status: "completed",
      externalId: result.id,
      result: result as any
    }).where(eq(SyncJobItems.id, item.id));

    await db.update(transactions).set({
      externalId: result.id,
      status: "synced"
    }).where(eq(transactions.id, transaction.id));
  }

  private getAdapter(platform: string, integration: any): AccountingAdapter {
    switch (platform.toLowerCase()) {
      case "quickbooks":
        return new QuickBooksAdapter(integration);
      case "xero":
        return new XeroAdapter(integration);
      case "zoho":
      case "zohobooks":
        return new ZohoAdapter(integration);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
