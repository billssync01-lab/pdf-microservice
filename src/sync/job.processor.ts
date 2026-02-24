import { db } from "../db";
import { SyncJobs, SyncJobItems, transactions, transactionLineItems, teams, Integrations } from "../schema";
import { eq, and, isNull } from "drizzle-orm";
import { QuickBooksAdapter } from "./adapters/quickbooks.adapter";
import { XeroAdapter } from "./adapters/xero.adapter";
import { ZohoAdapter } from "./adapters/zoho.adapter";
import { ReferenceResolver } from "./reference.resolver";
import { PayloadBuilder } from "./payload.builder";
import { AccountingAdapter, CreateTransactionResponse } from "./adapters/accounting.adapter";
import logger from "../utils/logger";
import * as fs from "fs";
import * as path from "path";

export class JobProcessor {
  private teamSettings: any;
  private defaultSettings: any;

  constructor() {
    this.loadDefaultSettings();
  }

  private loadDefaultSettings() {
    try {
      const settingsPath = path.join(__dirname, "../config/default-settings.json");
      if (fs.existsSync(settingsPath)) {
        this.defaultSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        logger.info({ settingsPath }, "Default settings loaded successfully");
      } else {
        this.defaultSettings = {};
        logger.warn({ settingsPath }, "Default settings file not found, using empty defaults");
      }
    } catch (error: any) {
      logger.error({ error: error.message }, "Failed to load default settings");
      this.defaultSettings = {};
    }
  }

  async processJob(jobId: string) {
    logger.info({ jobId }, "Starting job processing");

    try {
      const job = await db.query.SyncJobs.findFirst({
        where: eq(SyncJobs.id, jobId),
      });

      if (!job) {
        logger.error({ jobId }, "Job not found in database");
        throw new Error("Job not found");
      }

      logger.info({ jobId, platform: (job.payload as any).platform }, "Job fetched successfully");

      await db.update(SyncJobs).set({ 
        status: "processing", 
        startedAt: new Date(),
        lockedAt: new Date() 
      }).where(eq(SyncJobs.id, jobId));

      logger.info({ jobId }, "Job status updated to processing");

      const team = await db.query.teams.findFirst({
        where: eq(teams.id, job.organizationId),
      });

      if (!team) {
        logger.error({ jobId, organizationId: job.organizationId }, "Team/organization not found");
        throw new Error("Organization not found");
      }

      this.teamSettings = team?.settings || this.defaultSettings;
      logger.info({ jobId, organizationId: job.organizationId, settingsLoaded: !!this.teamSettings }, "Team settings loaded");

      const integration = await db.query.Integrations.findFirst({
        where: and(
          eq(Integrations.organizationId, job.organizationId),
          eq(Integrations.provider, (job.payload as any).platform),
          eq(Integrations.priority, 1),
          eq(Integrations.status, "1"),
          isNull(Integrations.deletedAt)
        ),
      });

      if (!integration) {
        logger.error({ jobId, platform: (job.payload as any).platform, organizationId: job.organizationId }, "Integration not found");
        await db.update(SyncJobs).set({ 
          status: "failed", 
          error: "Integration not found", 
          completedAt: new Date() 
        }).where(eq(SyncJobs.id, jobId));
        throw new Error("Integration not found");
      }

      logger.info({ jobId, provider: integration.provider }, "Integration found");

      const adapter = this.getAdapter((job.payload as any).platform, integration);
      const resolver = new ReferenceResolver(adapter, job.organizationId, this.teamSettings);

      const items = await db.query.SyncJobItems.findMany({
        where: eq(SyncJobItems.jobId, jobId),
      });

      logger.info({ jobId, totalItems: items.length }, "Job items fetched");

      let completed = 0;
      let failed = 0;
      let authError = false;

      for (const item of items) {
        try {
          logger.info({ jobId, itemId: item.id }, "Processing job item");
          await this.processItem(item, adapter, resolver, (job.payload as any).platform, jobId);
          completed++;

          await db.update(SyncJobs).set({
            progress: Math.round((completed / items.length) * 100),
            successCount: completed
          }).where(eq(SyncJobs.id, jobId));

          logger.info({ jobId, itemId: item.id, successCount: completed, progress: Math.round((completed / items.length) * 100) }, "Job item completed successfully");
        } catch (error: any) {
          const isAuthError = error.message?.includes("Token Expired") || 
                             error.message?.includes("Revoked") || 
                             error.message?.includes("Re-authentication");

          if (isAuthError) {
            logger.error({ 
              jobId, 
              itemId: item.id, 
              error: error.message,
              authError: true
            }, "Authentication/Authorization error - stopping job processing");
            authError = true;

            await db.update(SyncJobItems).set({ 
              status: "failed", 
              error: error.message 
            }).where(eq(SyncJobItems.id, item.id));

            await db.update(SyncJobs).set({ 
              status: "failed",
              error: "Integration authentication failed. Please re-authenticate the integration.",
              completedAt: new Date(),
              errorCount: failed + 1
            }).where(eq(SyncJobs.id, jobId));

            break;
          }

          failed++;
          logger.error({ 
            jobId, 
            itemId: item.id, 
            error: error.message,
            stack: error.stack 
          }, "Job item processing failed");

          await db.update(SyncJobItems).set({ 
            status: "failed", 
            error: error.message 
          }).where(eq(SyncJobItems.id, item.id));

          await db.update(SyncJobs).set({ 
            errorCount: failed 
          }).where(eq(SyncJobs.id, jobId));
        }
      }

      if (authError) {
        logger.info({ jobId }, "Job stopped due to authentication error");
        return;
      }

      const finalStatus = failed === 0 ? "completed" : failed === items.length ? "failed" : "partial";
      await db.update(SyncJobs).set({ 
        status: finalStatus, 
        completedAt: new Date(),
        progress: 100
      }).where(eq(SyncJobs.id, jobId));

      logger.info({ 
        jobId, 
        status: finalStatus, 
        successCount: completed, 
        errorCount: failed, 
        totalItems: items.length 
      }, "Job processing completed");
    } catch (error: any) {
      logger.error({ 
        jobId, 
        error: error.message,
        stack: error.stack 
      }, "Job processing failed with exception");

      await db.update(SyncJobs).set({ 
        status: "failed", 
        error: error.message,
        completedAt: new Date()
      }).where(eq(SyncJobs.id, jobId)).catch(err => {
        logger.error({ jobId, error: err.message }, "Failed to update job status to failed");
      });
    }
  }

  private async processItem(
    item: any, 
    adapter: AccountingAdapter, 
    resolver: ReferenceResolver, 
    platform: string,
    jobId: string
  ) {
    const itemId = item.id;

    try {
      logger.info({ itemId, referenceId: item.referenceId }, "Updating item status to processing");
      await db.update(SyncJobItems).set({ status: "processing" }).where(eq(SyncJobItems.id, itemId));

      logger.info({ itemId, transactionId: item.referenceId }, "Fetching transaction");
      const transaction = await db.query.transactions.findFirst({
        where: eq(transactions.id, item.referenceId),
      });

      if (!transaction) {
        logger.error({ itemId, transactionId: item.referenceId }, "Transaction not found");
        throw new Error(`Transaction not found: ${item.referenceId}`);
      }

      logger.info({ itemId, transactionId: transaction.id, type: transaction.type }, "Fetching transaction line items");
      const lineItems = await db.query.transactionLineItems.findMany({
        where: eq(transactionLineItems.transactionId, transaction.id),
      });

      logger.info({ itemId, lineItemCount: lineItems.length }, "Line items fetched");

      logger.info({ itemId, payee: transaction.payee, platform }, "Resolving contact reference");
      let contactId: string;
      try {
        contactId = await resolver.resolveContact(transaction.payee);
        logger.info({ itemId, contactId }, "Contact resolved successfully");
      } catch (error: any) {
        logger.error({ itemId, payee: transaction.payee, error: error.message }, "Failed to resolve contact");
        throw new Error(`Contact resolution failed: ${error.message}`);
      }

      logger.info({ itemId, accountName: "General Expense", platform }, "Resolving account reference");
      let accountId: string;
      try {
        accountId = await resolver.resolveAccount("General Expense");
        logger.info({ itemId, accountId }, "Account resolved successfully");
      } catch (error: any) {
        logger.error({ itemId, error: error.message }, "Failed to resolve account");
        throw new Error(`Account resolution failed: ${error.message}`);
      }

      const references = { contactId, accountId };
      logger.info({ itemId, contactId, accountId }, "Building payload for accounting platform");
      let payload: any;
      try {
        payload = PayloadBuilder.build(platform, transaction, lineItems, references, this.teamSettings);
        logger.info({ itemId, payloadKeys: Object.keys(payload) }, "Payload built successfully");
      } catch (error: any) {
        logger.error({ itemId, error: error.message }, "Failed to build payload");
        throw new Error(`Payload build failed: ${error.message}`);
      }

      logger.info({ itemId, transactionType: transaction.type, platform }, `Creating ${transaction.type} in ${platform}`);
      let result: CreateTransactionResponse;
      try {
        if (transaction.type === 'expense') {
          result = await adapter.createExpense!(payload);
        } else {
          result = await adapter.createInvoice!(payload);
        }
        logger.info({ itemId, externalId: result.id }, `${transaction.type} created successfully in ${platform}`);
      } catch (error: any) {
        logger.error({ itemId, transactionType: transaction.type, platform, error: error.message }, `Failed to create ${transaction.type} in ${platform}`);
        throw error;
      }

      if (!result || !result.id) {
        logger.error({ itemId, result }, "API response missing required ID field");
        throw new Error("Invalid response from accounting platform: missing ID");
      }

      logger.info({ itemId, externalId: result.id }, "Updating sync job item with result");
      await db.update(SyncJobItems).set({
        status: "completed",
        externalId: result.id,
        result: result as any,
        payload: payload as any
      }).where(eq(SyncJobItems.id, itemId));

      logger.info({ itemId, transactionId: transaction.id, externalId: result.id }, "Updating transaction with external ID and accounting data");
      
      const accountingUrl = result.url || result.accountingUrl || "";
      
      await db.update(transactions).set({
        externalId: result.id,
        accountingId: result.id,
        accountingUrl: accountingUrl,
        status: "synced"
      }).where(eq(transactions.id, transaction.id));

      if (lineItems.length > 0 && result.lineItems) {
        logger.info({ itemId, lineItemCount: lineItems.length }, "Updating transaction line items with external account IDs");
        
        for (const lineItem of lineItems) {
          const matchedLineItem = result.lineItems.find((li: any) => 
            li.description === lineItem.productName || li.itemRef === lineItem.id
          );

          if (matchedLineItem) {
            await db.update(transactionLineItems).set({
              lineAccountId: matchedLineItem.accountRef || matchedLineItem.accountId,
              externalId: matchedLineItem.id || matchedLineItem.lineId
            }).where(eq(transactionLineItems.id, lineItem.id));

            logger.info({ itemId, lineItemId: lineItem.id, lineAccountId: matchedLineItem.accountRef }, "Line item updated with account reference");
          } else {
            logger.warn({ itemId, lineItemId: lineItem.id, productName: lineItem.productName }, "Could not match line item in API response");
          }
        }
      }

      logger.info({ itemId, externalId: result.id, platform }, "Job item processing completed successfully");
    } catch (error: any) {
      logger.error({ 
        itemId, 
        error: error.message,
        stack: error.stack 
      }, "Error processing job item");
      throw error;
    }
  }

  private getAdapter(platform: string, integration: any): AccountingAdapter {
    const normalizedPlatform = platform.toLowerCase();
    logger.info({ platform: normalizedPlatform }, "Getting adapter for platform");

    switch (normalizedPlatform) {
      case "quickbooks":
        return new QuickBooksAdapter(integration);
      case "xero":
        return new XeroAdapter(integration);
      case "zoho":
      case "zohobooks":
        return new ZohoAdapter(integration);
      default:
        logger.error({ platform: normalizedPlatform }, "Unsupported accounting platform");
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
