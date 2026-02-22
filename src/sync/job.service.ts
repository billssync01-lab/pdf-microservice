import { db } from "../db";
import { SyncJobs, SyncJobItems, transactions } from "../schema";
import { eq, inArray } from "drizzle-orm";
import { and, isNull } from "drizzle-orm"; 
import logger from "../utils/logger";

export class JobService {
  async createSyncJob(params: {
    userId: number;
    organizationId: number;
    platform: string;
    transactionIds: string[];
  }) {
    logger.info({ params }, "Creating sync job with params:");
    const { userId, organizationId, platform, transactionIds } = params;

    const [job] = await db.insert(SyncJobs).values({
      userId,
      organizationId,
      documentType: "accounting_sync",
      status: "queued",
      payload: { platform, transactionIds },
      totalCount: transactionIds.length,
    }).returning();

    logger.info({ jobId: job.id }, "Created sync job with ID:");

    const jobItems = transactionIds.map((tid) => ({
      jobId: job.id,
      referenceId: tid,
      status: "queued",
    }));

    await db.insert(SyncJobItems).values(jobItems);
    logger.info({ jobId: job.id, itemCount: jobItems.length }, "Created sync job items with count:");
    return job;
  }

  async createBulkSyncJob(userId: number, organizationId: number, platform: string) {
    logger.info({ userId, organizationId, platform }, "Creating bulk sync job for user and organization:");
    // Find unsynced transactions
    const unsynced = await db.query.transactions.findMany({
      where: and(
        eq(transactions.status, "ready"),
        isNull(transactions.externalId)
      ),
    });

    if (unsynced.length === 0) return null;
    logger.info({ count: unsynced.length }, "Found unsynced transactions for bulk sync job:");
    return this.createSyncJob({
      userId,
      organizationId,
      platform,
      transactionIds: unsynced.map(t => t.id),
    });
  }
}


