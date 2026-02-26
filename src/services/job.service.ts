import { db } from '../db';
import { Receipts, SyncJobs, users } from '../schema';
import { eq, sql } from 'drizzle-orm';
import { builder, extractWithVision, mergeResults, refineExtraction, statementBuilder } from './extraction';
import axios from 'axios';
import logger from '../utils/logger';
// import { notifyStatusUpdate } from '../utils/sse';
import { pdfToImages } from './pdf.service';
import fs from 'fs';

export async function getReceiptsByJobId(jobId: string) {
  return await db.select().from(Receipts).where(eq(Receipts.syncJobId, jobId));
}

export async function updateReceiptData(
  userId: number,
  organizationId: number,
  receiptId: number,
  rawData: Record<string, any>,
  fileUrl?: string,
  buildPayload?: Record<string, any>
) {
  logger.info({ receiptId, organizationId }, "Updating receipt data for receipt and organization:")
  const result = await db.update(Receipts)
    .set({
      rawData,
      buildPayload: buildPayload || undefined,
      fileUrl: fileUrl || undefined,
      status: 'parsed',
      updatedAt: new Date(),
    })
    .where(eq(Receipts.id, receiptId))
    .returning();
  logger.info({ receiptId, organizationId }, "Updated receipt data for receipt and organization:")
  // await notifyStatusUpdate(organizationId, receiptId, 'parsed', { fileUrl });
  return result[0];
}

export async function updateReceiptError(organizationId: number, receiptId: number, errorMessage: string) {
  logger.info({ receiptId, organizationId, errorMessage }, "Updating receipt with error message for receipt and organization:")
  const result = await db.update(Receipts)
    .set({
      status: 'parsing failed',
      errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(Receipts.id, receiptId))
    .returning();
  logger.info({ receiptId, organizationId, errorMessage }, "Updated receipt with error message for receipt and organization:")
  // await notifyStatusUpdate(organizationId, receiptId, 'parsing failed', { error: errorMessage });
  return result;
}

export async function deductCredits(userId: number, amount: number) {
  logger.info({ userId, amount }, "Deducting credits for user:")
  await db
    .update(users)
    .set({
      credits: sql`${users.credits} - ${amount}`,
    })
    .where(eq(users.id, userId));
  logger.info({ userId, amount }, "Deducted credits for user:")
}

export async function processReceiptPage(

  receiptId: number,
  userId: number,
  category: string,
  documentType: string,
  type: "general" | "mileage",
  pageType: string = "single"
) {
  logger.info({ receiptId, userId, category, documentType, type, pageType }, "Processing receipt page with details:")
  try {
    // Update status to inprogress
    await db.update(Receipts)
      .set({ status: 'inprogress', updatedAt: new Date() })
      .where(eq(Receipts.id, receiptId));

    const receipt = (await db.select().from(Receipts).where(eq(Receipts.id, receiptId)))[0];
    logger.info({ receiptId, organizationId: receipt?.organizationId }, "Fetched receipt details for processing:")
    if (!receipt || !receipt.fileUrl) {
      logger.info({receipt: receipt}, "Receipt not found or missing file URL")
      throw new Error("Receipt not found or missing file URL");
    }

    // await notifyStatusUpdate(receipt.organizationId, receiptId, 'inprogress');
    logger.info({ receiptId, organizationId: receipt.organizationId }, "Notified status update to inprogress for receipt:")
    // Fetch file buffer
    const response = await axios.get(receipt.fileUrl, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'];

    let imageBuffer: Buffer;

    if (contentType === 'application/pdf' || receipt.fileUrl.toLowerCase().endsWith('.pdf')) {
      logger.info({ receiptId }, "Converting PDF to image for extraction");
      const imagePaths = await pdfToImages(fileBuffer, `job-${receiptId}`);
      if (imagePaths.length === 0) {
        logger.info({ receiptId }, "PDF to image conversion failed, no images generated");
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
    logger.info({ receiptId, category, type, documentType, pageType }, "Built prompt for receipt processing:")
    // Extract with vision
    const result = await extractWithVision(imageBuffer, prompt, type);
    if (result) {
      logger.info({ receiptId, result }, "Extraction successful for receipt:")
      await deductCredits(userId, 1);
      logger.info({ receiptId, userId }, "Deducted credits for receipt processing:")
    }

    // Save results
    await updateReceiptData(userId, receipt.organizationId, receiptId, result, receipt.fileUrl);
    return result;

  } catch (error: any) {
    logger.info({ receiptId, error }, `Error processing receipt ${receiptId}:`);
    // We need organizationId here. If receipt fetch failed, we might not have it.
    // But if we have receiptId, we can probably fetch it or assume it's available.
    // Let's try to get it from the receipt we fetched.
    const results = await db.select().from(Receipts).where(eq(Receipts.id, receiptId));
    const orgId = results[0]?.organizationId;
    if (orgId) {
      await updateReceiptError(orgId, receiptId, error.message || "Unknown error");
      logger.info({ receiptId, organizationId: orgId, error }, "Updated receipt with error message for receipt and organization:")
    }
    return false;
  }
}

export async function processStatementPage(
  receiptId: number,
  userId: number,
  category: string,
  documentType: string,
  type: string,
  pageType: string = "single",
  text?: string
) {
  logger.info({ receiptId, userId, category, documentType, type, pageType }, "Processing statement page with details:")
  try {
    // Update status to inprogress
    await db.update(Receipts)
      .set({ status: 'inprogress', updatedAt: new Date() })
      .where(eq(Receipts.id, receiptId));

    const receipt = (await db.select().from(Receipts).where(eq(Receipts.id, receiptId)))[0];
    if (!receipt || !receipt.fileUrl) {
      throw new Error("Receipt not found or missing file URL");
    }

    // await notifyStatusUpdate(receipt.organizationId, receiptId, 'inprogress');

    // Fetch file buffer
    const response = await axios.get(receipt.fileUrl, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'];

    let imageBuffer: Buffer;

    if (contentType === 'application/pdf' || receipt.fileUrl.toLowerCase().endsWith('.pdf')) {
      const imagePaths = await pdfToImages(fileBuffer, `job-${receiptId}`);
      if (imagePaths.length === 0) {
        throw new Error("Failed to convert PDF to images");
      }
      imageBuffer = fs.readFileSync(imagePaths[0]);
    } else {
      imageBuffer = fileBuffer;
    }

    // Build initial prompt
    const prompt = await statementBuilder(category, documentType, pageType);
    
    // Extract with vision
    const buildPayload = await extractWithVision(imageBuffer, prompt, type);
    
    let finalRawData = buildPayload;

    // If text is provided, refine the extraction
    if (text) {
      logger.info({ receiptId }, "Refining statement extraction with provided text");
      finalRawData = await refineExtraction(text, buildPayload);
    }

    // Save results
    await updateReceiptData(userId, receipt.organizationId, receiptId, finalRawData, receipt.fileUrl, buildPayload);
    
    await deductCredits(userId, 1);
    
    return finalRawData;

  } catch (error: any) {
    logger.error({ receiptId, error }, `Error processing statement ${receiptId}:`);
    const results = await db.select().from(Receipts).where(eq(Receipts.id, receiptId));
    const orgId = results[0]?.organizationId;
    if (orgId) {
      await updateReceiptError(orgId, receiptId, error.message || "Unknown error");
    }
    return false;
  }
}

export async function processJob(jobOrId: any) {
  let job: any;
  logger.info({ jobOrId }, "Process job started")
  
  if (typeof jobOrId === 'string') {
    // If it's a UUID (SyncJob)
    if (jobOrId.includes('-')) {
      const results = await db.select().from(SyncJobs).where(eq(SyncJobs.id, jobOrId));
      job = results[0];
    } else {
      // It's a Receipt ID
      const id = parseInt(jobOrId, 10);
      const results = await db.select().from(Receipts).where(eq(Receipts.id, id));
      const receipt = results[0];
      if (receipt) {
        const syncResults = await db.select().from(SyncJobs).where(eq(SyncJobs.id, receipt.syncJobId));
        job = syncResults[0];
      }
    }
  } else if (jobOrId && jobOrId.syncJobId) {
    // It's a Receipt record
    const syncResults = await db.select().from(SyncJobs).where(eq(SyncJobs.id, jobOrId.syncJobId));
    job = syncResults[0];
  } else {
    // It's a SyncJob record or unknown
    job = jobOrId;
  }

  if (!job) {
    logger.info({ jobOrId }, "Process job not found")
    return { success: false, error: "Job not found" };
  }

  const status = job.status;
  const cancelledAt = job.cancelledAt || job.cancelled_at;
  const documentType = job.documentType || job.document_type;
  const payload = job.payload as any;
  const pageType = payload?.pageType || "single";

  if (cancelledAt || status === "cancelled") {
    logger.info({ jobId: job.id }, "Process job cancelled")
    return { success: false, error: "Job cancelled", jobId: job.id };
  }

  // Update SyncJob status to processing
  await db.update(SyncJobs)
    .set({ status: 'processing', updatedAt: new Date(), startedAt: new Date() })
    .where(eq(SyncJobs.id, job.id));

  logger.info("Updated job status to processing")
  // await notifyStatusUpdate(job.organizationId, job.id, 'processing');

  const receipts = await getReceiptsByJobId(job.id);
  let allSucceeded = true;
  const results: any[] = [];

  for (const receipt of receipts) {
    let result;
    if (documentType === "Receipt" || documentType === "Receipt Image" || documentType === "Receipt PDF" || documentType === "Invoice PDF" || documentType === "Email invoice") {
      result = await processReceiptPage(
        receipt.id,
        receipt.userId,
        payload?.category || "auto-categorize",
        receipt.documentType,
        payload?.type || "general",
        payload?.pageType || "single"
      );
    } else if (documentType?.toLowerCase() === "bank statement") {
      result = await processStatementPage(
        receipt.id,
        receipt.userId,
        payload?.category || "auto-categorize",
        receipt.documentType,
        payload?.type || "Bank statement",
        payload?.pageType || "single",
        payload?.text,
      );
    }

    if (!result) {
      allSucceeded = false;
    } else {
      results.push(result);
    }

    if (pageType === 'multi') {
      // Update SyncJob results incrementally
      await db.update(SyncJobs)
        .set({ result: results, updatedAt: new Date() })
        .where(eq(SyncJobs.id, job.id));
    }
  }

  // Final merge for single page type
  let finalResult = results;
  if (pageType === 'single' && results.length > 0) {
    finalResult = await mergeResults(results, documentType);
  }

  // Mark job status
  const finalStatus = allSucceeded ? 'completed' : 'failed';
  await db.update(SyncJobs)
    .set({ 
      status: finalStatus, 
      result: finalResult, 
      updatedAt: new Date(),
      completedAt: new Date(),
      successCount: results.length,
      errorCount: receipts.length - results.length
    })
    .where(eq(SyncJobs.id, job.id));
  
  logger.info({ finalStatus }, "Marked job status")
  // await notifyStatusUpdate(job.organizationId, job.id, finalStatus);

  return {
    success: allSucceeded,
    count: receipts.length,
    jobId: job.id
  };
}
