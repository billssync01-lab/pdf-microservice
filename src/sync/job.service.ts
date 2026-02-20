import { db } from "../db";
import { SyncJobs, SyncJobItems, transactions } from "../schema";
import { eq, inArray } from "drizzle-orm";

export class JobService {
  async createSyncJob(params: {
    userId: number;
    organizationId: number;
    platform: string;
    transactionIds: string[];
  }) {
    const { userId, organizationId, platform, transactionIds } = params;

    const [job] = await db.insert(SyncJobs).values({
      userId,
      organizationId,
      documentType: "accounting_sync",
      status: "queued",
      payload: { platform, transactionIds },
      totalCount: transactionIds.length,
    }).returning();

    const jobItems = transactionIds.map((tid) => ({
      jobId: job.id,
      referenceId: tid,
      status: "queued",
    }));

    await db.insert(SyncJobItems).values(jobItems);

    return job;
  }

  async createBulkSyncJob(userId: number, organizationId: number, platform: string) {
    // Find unsynced transactions
    const unsynced = await db.query.transactions.findMany({
      where: and(
        eq(transactions.status, "ready"),
        isNull(transactions.externalId)
      ),
    });

    if (unsynced.length === 0) return null;

    return this.createSyncJob({
      userId,
      organizationId,
      platform,
      transactionIds: unsynced.map(t => t.id),
    });
  }
}

import { and, isNull } from "drizzle-orm";
