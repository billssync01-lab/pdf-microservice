import { db } from "../db";
import { SyncJobs } from "../schema";
import { eq, and, isNull, or, lt } from "drizzle-orm";
import { JobProcessor } from "../sync/job.processor";

const jobProcessor = new JobProcessor();

async function pollJobs() {
  console.log("Polling for accounting sync jobs...");
  
  const queuedJob = await db.query.SyncJobs.findFirst({
    where: and(
      eq(SyncJobs.documentType, "accounting_sync"),
      or(
        eq(SyncJobs.status, "queued"),
        and(
          eq(SyncJobs.status, "failed"),
          lt(SyncJobs.attempts, SyncJobs.maxAttempts),
          lt(SyncJobs.nextRunAt, new Date())
        )
      )
    ),
    orderBy: (jobs, { asc }) => [asc(jobs.createdAt)],
  });

  if (queuedJob) {
    console.log(`Processing job ${queuedJob.id}...`);
    try {
      await jobProcessor.processJob(queuedJob.id);
      console.log(`Job ${queuedJob.id} finished.`);
    } catch (err) {
      console.error(`Failed to process job ${queuedJob.id}:`, err);
    }
  }

  setTimeout(pollJobs, 5000);
}

pollJobs();
