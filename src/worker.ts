import { db } from './db';
import { SyncJobs, Receipts } from './schema';
import { eq, and, isNull, lt, inArray, sql } from 'drizzle-orm';
import { processJob } from './services/job.service';
import logger from './utils/logger';

async function claimJob() {
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
      WHERE ${Receipts.status} = 'queue' AND ${Receipts.lockedAt} IS NULL
      FOR UPDATE SKIP LOCKED
      LIMIT ${concurrency}
    )`))
    .returning();

  logger.info({ count: result.length }, "Claim jobs")

  return result;
}

async function workerLoop() {
  console.log('🚀 Receipt Job Processing Worker started...');

  while (true) {
    try {
      const jobs = await claimJob();

      if (jobs && jobs.length > 0) {
        logger.info({ count: jobs.length }, "Claimed jobs")
        console.log(`📦 Claimed ${jobs.length} jobs`);
        
        // Process jobs in parallel up to concurrency limit
        await Promise.all(jobs.map(async (job) => {
          try {
            logger.info({ job, jobid: job.syncJobId, documentType: job.documentType }, "Processing job")
            console.log(`⏳ Processing job: ${job.syncJobId} (${job.documentType})`);
            const result = await processJob(job);
            logger.info({ job, jobid: job.syncJobId, result }, "Processed job")
            console.log(`✅ Processed job: ${job.syncJobId}`, result);
          } catch (jobError) {
            console.error(`❌ Error processing job ${job.syncJobId}:`, jobError);
          }
        }));
      } else {
        // Random sleep between 1s and 3s
        const sleepTime = Math.floor(Math.random() * 2000) + 1000;
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      }
    } catch (error) {
      logger.info({ error }, "Worker loop error")
      console.error('❌ Worker loop error:', error);
      // Wait a bit before retrying after error
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

workerLoop().catch(err => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
