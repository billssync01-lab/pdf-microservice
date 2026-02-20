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

  // Handle stuck jobs: set status to 'stuck' if processing for > 5 mins
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stuckResult = await db.update(Receipts)
    .set({ status: 'stuck', updatedAt: new Date() })
    .where(and(
      eq(Receipts.status, 'processing'),
      lt(Receipts.lockedAt, fiveMinutesAgo)
    ))
    .returning();
  
  if (stuckResult.length > 0) {
    logger.info({ count: stuckResult.length }, "Marked jobs as stuck");
  }

  const concurrency = 5;

  // Claim new jobs using a subquery to limit to concurrency (5)
  // We use FOR UPDATE SKIP LOCKED to prevent multiple workers from claiming same jobs
  const result = await db.update(Receipts)
    .set({ lockedAt: new Date() })
    .where(inArray(Receipts.id, sql`(
      SELECT ${Receipts.id} FROM ${Receipts}
      WHERE ${Receipts.status} = 'queued' AND ${Receipts.lockedAt} IS NULL
      FOR UPDATE SKIP LOCKED
      LIMIT ${concurrency}
    )`))
    .returning();

  logger.info({ count: result.length }, "Claim jobs")

  return result;
}

async function workerLoop() {
  console.log('🚀 Receipt & Accounting Job Processing Worker started...');

  while (true) {
    try {
      // 1. Handle Receipt Jobs
      const receiptJobs = await claimReceiptJobs();
      if (receiptJobs && receiptJobs.length > 0) {
        await Promise.all(receiptJobs.map(async (job) => {
          try {
            await processJob(job);
          } catch (jobError) {
            console.error(`❌ Error processing receipt job ${job.syncJobId}:`, jobError);
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
            console.error(`❌ Error processing accounting job ${job.id}:`, jobError);
          }
        }));
      }

      if ((!receiptJobs || receiptJobs.length === 0) && (!accountingJobs || accountingJobs.length === 0)) {
        const sleepTime = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      }
    } catch (error) {
      logger.info({ error }, "Worker loop error")
      console.error('❌ Worker loop error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

workerLoop().catch(err => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
