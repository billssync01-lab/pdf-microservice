import { db } from './db';
import { SyncJobs, Receipts } from './schema';
import { eq, and, isNull, lt, inArray, sql, or } from 'drizzle-orm';
import { processJob } from './services/job.service';
import { JobProcessor } from './sync/job.processor';
import { runAutomationCron } from './worker/automation.cron';
import { runDeltaSyncCron } from './worker/delta-sync.cron';
import logger from './utils/logger';

const accountingProcessor = new JobProcessor();

async function claimAccountingJobs() {
  const concurrency = 3;
  return await db.update(SyncJobs)
    .set({ lockedAt: new Date(), status: 'processing' })
    .where(inArray(SyncJobs.id, sql`(
      SELECT ${SyncJobs.id} FROM ${SyncJobs}
      WHERE ${SyncJobs.documentType} = 'accounting_sync' 
      AND (${SyncJobs.status} = 'queued' OR (${SyncJobs.status} = 'failed' AND ${SyncJobs.attempts} < ${SyncJobs.maxAttempts} AND ${SyncJobs.nextRunAt} < NOW()))
      AND ${SyncJobs.lockedAt} IS NULL
      FOR UPDATE SKIP LOCKED
      LIMIT ${concurrency}
    )`))
    .returning();
}

async function claimReceiptJobs() {
  logger.info("Claiming jobs")

  // Handle stuck jobs: set status to 'failed' if processing for > 15 mins
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  await db.update(SyncJobs)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(and(
      eq(SyncJobs.status, 'processing'),
      lt(SyncJobs.lockedAt, fifteenMinutesAgo)
    ));

  const concurrency = 5;

  // Claim new sync jobs that are not accounting sync
  const result = await db.update(SyncJobs)
    .set({ lockedAt: new Date(), status: 'processing' })
    .where(inArray(SyncJobs.id, sql`(
      SELECT ${SyncJobs.id} FROM ${SyncJobs}
      WHERE ${SyncJobs.status} = 'queued' 
      AND ${SyncJobs.documentType} != 'accounting_sync'
      AND ${SyncJobs.lockedAt} IS NULL
      FOR UPDATE SKIP LOCKED
      LIMIT ${concurrency}
    )`))
    .returning();

  logger.info({ count: result.length }, "Claim jobs")

  return result;
}

async function workerLoop() {
  logger.info("Receipt & Accounting Job Processing Worker started...")
  while (true) {
    try {
      // 1. Handle Receipt Jobs
      const receiptJobs = await claimReceiptJobs();
      if (receiptJobs && receiptJobs.length > 0) {
        await Promise.all(receiptJobs.map(async (job) => {
          try {
            await processJob(job);
          } catch (jobError) {
            logger.info({ jobId: job.id, error: jobError }, `Error processing receipt job ${job.id}:`);
          }
        }));
      }

      // 2. Handle Accounting Jobs
      const accountingJobs = await claimAccountingJobs();
      if (accountingJobs && accountingJobs.length > 0) {
        await Promise.all(accountingJobs.map(async (job) => {
          try {
            await accountingProcessor.processJob(job.id);
          } catch (jobError) {
            logger.info({ jobId: job.id, error: jobError }, `Error processing accounting job ${job.id}:`);
          }
        }));
      }

      if ((!receiptJobs || receiptJobs.length === 0) && (!accountingJobs || accountingJobs.length === 0)) {
        const sleepTime = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      }
    } catch (error) {
      logger.info({ error }, 'Worker loop error:');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

workerLoop().catch(err => {
  logger.info({ error: err }, 'Fatal worker error:');
  process.exit(1);
});
