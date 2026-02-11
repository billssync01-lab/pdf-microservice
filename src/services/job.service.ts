import { db } from '../db';
import { Receipts, SyncJobs, users } from '../schema';
import { eq, sql } from 'drizzle-orm';
import { builder, extractWithVision } from './extraction';
import axios from 'axios';
import logger from '../utils/logger';
import { notifyStatusUpdate } from '../utils/sse';
import { pdfToImages } from './pdf.service';
import fs from 'fs';

export async function getReceiptsByJobId(jobId: string) {
  return await db.select().from(Receipts).where(eq(Receipts.syncJobId, jobId));
}

export async function updateReceiptData(
  receiptId: number,
  rawData: Record<string, any>,
  fileUrl?: string
) {
  const result = await db.update(Receipts)
    .set({
      rawData,
      fileUrl: fileUrl || undefined,
      status: 'parsed',
      updatedAt: new Date(),
    })
    .where(eq(Receipts.id, receiptId))
    .returning();

  await notifyStatusUpdate(receiptId, 'parsed', { fileUrl });
  return result[0];
}

export async function updateReceiptError(receiptId: number, errorMessage: string) {
  const result = await db.update(Receipts)
    .set({
      status: 'parsing failed',
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(Receipts.id, receiptId))
    .returning();

  await notifyStatusUpdate(receiptId, 'parsing failed', { error: errorMessage });
  return result;
}

export async function deductCredits(userId: number, amount: number) {
  await db
    .update(users)
    .set({
      credits: sql`${users.credits} - ${amount}`,
    })
    .where(eq(users.id, userId));
}

export async function processReceiptPage(
  receiptId: number,
  userId: number,
  category: string,
  documentType: string,
  type: "general" | "mileage",
  pageType: string = "single"
) {
  try {
    // Update status to inprogress
    await db.update(Receipts)
      .set({ status: 'inprogress', updatedAt: new Date() })
      .where(eq(Receipts.id, receiptId));

    await notifyStatusUpdate(receiptId, 'inprogress');

    const receipt = (await db.select().from(Receipts).where(eq(Receipts.id, receiptId)))[0];
    if (!receipt || !receipt.fileUrl) {
      throw new Error("Receipt not found or missing file URL");
    }

    // Fetch file buffer
    const response = await axios.get(receipt.fileUrl, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'];

    let imageBuffer: Buffer;

    if (contentType === 'application/pdf' || receipt.fileUrl.toLowerCase().endsWith('.pdf')) {
      logger.info({ receiptId }, "Converting PDF to image for extraction");
      const imagePaths = await pdfToImages(fileBuffer, `job-${receiptId}`);
      if (imagePaths.length === 0) {
        throw new Error("Failed to convert PDF to images");
      }
      // Use the first page for now
      imageBuffer = fs.readFileSync(imagePaths[0]);
      
      // Clean up temp files (optional but recommended)
      // for (const p of imagePaths) fs.unlinkSync(p);
    } else {
      imageBuffer = fileBuffer;
    }

    // Build prompt
    const prompt = await builder(category, type, documentType, pageType);

    // Extract with vision
    const result = await extractWithVision(imageBuffer, prompt, type);
    if (result) {
      await deductCredits(userId, 1);
    }

    // Save results
    await updateReceiptData(receiptId, result, receipt.fileUrl);
    return true;

  } catch (error: any) {
    console.error(`Error processing receipt ${receiptId}:`, error);
    await updateReceiptError(receiptId, error.message || "Unknown error");
    return false;
  }
}

export async function processJob(jobOrId: any) {
  let job;
  logger.info({ job, jobOrId }, "Process job started")
  if (typeof jobOrId === 'string') {
    const id = parseInt(jobOrId, 10);
    logger.info("Getting job details")
    const results = await db.select().from(Receipts).where(eq(Receipts.id, id));
    job = results[0];
  } else {
    job = jobOrId;
  }

  if (!job) {
    logger.info({ job, jobOrId }, "Process job not found")
    return { success: false, error: "Job not found" };
  }

  const status = job.status;
  const cancelledAt = job.cancelledAt || job.cancelled_at;
  const documentType = job.documentType || job.document_type;
  const payload = job.payload as any;

  if (cancelledAt || status === "cancelled") {
    logger.info({ job, jobOrId }, "Process job cancelled")
    return { success: false, error: "Job cancelled", jobId: job.id };
  }

  await db.update(Receipts)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(eq(Receipts.id, job.id));
  logger.info("Updated job status to processing")
  await notifyStatusUpdate(job.id, 'processing');

  if (documentType === "Receipt" || documentType === "Receipt Image") {
    logger.info({ documentType, job, jobId: job.syncJobId }, "Fetching job details")
    const receipts = await getReceiptsByJobId(job.syncJobId);

    let allSucceeded = true;
    for (const receipt of receipts) {
      const success = await processReceiptPage(
        receipt.id,
        receipt.userId,
        payload?.category || "auto-categorize",
        receipt.documentType,
        payload?.type || "general",
        payload?.pageType || "single"
      );
      if (!success) {
        allSucceeded = false;
      }
    }

    // Mark job status
    const finalStatus = allSucceeded ? 'completed' : 'parsing failed';
    await db.update(Receipts)
      .set({ status: finalStatus, updatedAt: new Date() })
      .where(eq(Receipts.id, job.id));
    logger.info({ finalStatus }, "Marked job status")
    await notifyStatusUpdate(job.id, finalStatus);


    return {
      success: allSucceeded,
      count: receipts.length,
      jobId: job.id
    };
  }

  return {
    success: false,
    error: `Unknown job type: ${documentType}`,
    jobId: job.id
  };
}
