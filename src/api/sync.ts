import { JobService } from "../sync/job.service";
import { ReferenceDataService } from "../sync/reference.service";
import { Router } from "express";
import logger from "../utils/logger";

const router = Router();
const jobService = new JobService();
const referenceService = new ReferenceDataService();

router.post("/manual", async (req, res) => {
  try {
    const { userId, organizationId, platform, transactionIds } = req.body;
    logger.info({ userId, organizationId, platform, transactionIds }, "Received request to create manual sync job with details:")
    const job = await jobService.createSyncJob({ userId, organizationId, platform, transactionIds });
    logger.info({ jobId: job.id }, "Manual sync job created with ID:")
    res.json({ success: true, jobId: job.id });
  } catch (error: any) {
    logger.info({ error }, "Error creating manual sync job:")
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const { userId, organizationId, platform } = req.body;
    logger.info({ userId, organizationId, platform }, "Received request to create bulk sync job with details:")
    const job = await jobService.createBulkSyncJob(userId, organizationId, platform);
    logger.info({ job }, "Bulk sync job created with details:")
    res.json({ success: true, job });
  } catch (error: any) {
    logger.info({ error }, "Error creating bulk sync job:")
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync-references", async (req, res) => {
  try {
    const { organizationId, provider } = req.body;
    logger.info({ organizationId, provider }, "Received request to sync reference data with details:")
    await referenceService.syncAllReferences(organizationId, provider);
    logger.info({ organizationId, provider }, "Reference data sync completed for organization and provider:")
    res.json({ success: true });
  } catch (error: any) {
    logger.info({ error }, "Error syncing reference data:")
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
