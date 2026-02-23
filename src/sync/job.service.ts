import { db } from "../db";
import { SyncJobs, SyncJobItems, transactions } from "../schema";
import { eq, inArray, and, isNull } from "drizzle-orm";
import logger from "../utils/logger";

export class JobService {
  async createSyncJob(params: {
    userId: number;
    organizationId: number;
    platform: string;
    transactionIds: string[];
  }) {
    logger.info({ 
      userId: params.userId, 
      organizationId: params.organizationId, 
      platform: params.platform, 
      transactionCount: params.transactionIds.length 
    }, "Creating sync job");

    try {
      const { userId, organizationId, platform, transactionIds } = params;

      if (!transactionIds || transactionIds.length === 0) {
        logger.warn({ userId, organizationId }, "No transaction IDs provided for sync job");
        throw new Error("At least one transaction ID is required");
      }

      const [job] = await db.insert(SyncJobs).values({
        userId,
        organizationId,
        documentType: "accounting_sync",
        status: "queued",
        payload: { platform, transactionIds },
        totalCount: transactionIds.length,
      }).returning();

      logger.info({ 
        jobId: job.id, 
        userId, 
        organizationId, 
        platform 
      }, "Sync job created");

      const jobItems = transactionIds.map((tid) => ({
        jobId: job.id,
        referenceId: tid,
        status: "queued",
      }));

      logger.info({ jobId: job.id, itemCount: jobItems.length }, "Inserting sync job items");
      await db.insert(SyncJobItems).values(jobItems);

      logger.info({ 
        jobId: job.id, 
        transactionCount: transactionIds.length, 
        platform 
      }, "Updating transactions with accounting platform");

      await db.update(transactions).set({
        accountingPlatform: platform
      }).where(inArray(transactions.id, transactionIds));

      logger.info({ 
        jobId: job.id, 
        itemCount: jobItems.length,
        transactionCount: transactionIds.length
      }, "Sync job created successfully");

      return job;
    } catch (error: any) {
      logger.error({ 
        error: error.message,
        stack: error.stack,
        params 
      }, "Failed to create sync job");
      throw error;
    }
  }

  async createBulkSyncJob(userId: number, organizationId: number, platform: string) {
    logger.info({ 
      userId, 
      organizationId, 
      platform 
    }, "Creating bulk sync job");

    try {
      logger.info({ organizationId }, "Searching for unsynced transactions");

      const unsynced = await db.query.transactions.findMany({
        where: and(
          eq(transactions.status, "ready"),
          isNull(transactions.externalId)
        ),
      });

      logger.info({ 
        organizationId, 
        count: unsynced.length 
      }, "Found unsynced transactions");

      if (unsynced.length === 0) {
        logger.info({ organizationId }, "No unsynced transactions found for bulk sync");
        return null;
      }

      return this.createSyncJob({
        userId,
        organizationId,
        platform,
        transactionIds: unsynced.map(t => t.id),
      });
    } catch (error: any) {
      logger.error({ 
        userId,
        organizationId,
        platform,
        error: error.message,
        stack: error.stack
      }, "Failed to create bulk sync job");
      throw error;
    }
  }
}


