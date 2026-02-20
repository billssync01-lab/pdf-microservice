import { JobService } from "../sync/job.service";
import { ReferenceDataService } from "../sync/reference.service";
import { Router } from "express";

const router = Router();
const jobService = new JobService();
const referenceService = new ReferenceDataService();

router.post("/manual", async (req, res) => {
  try {
    const { userId, organizationId, platform, transactionIds } = req.body;
    const job = await jobService.createSyncJob({ userId, organizationId, platform, transactionIds });
    res.json({ success: true, jobId: job.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const { userId, organizationId, platform } = req.body;
    const job = await jobService.createBulkSyncJob(userId, organizationId, platform);
    res.json({ success: true, job });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync-references", async (req, res) => {
  try {
    const { organizationId, provider } = req.body;
    await referenceService.syncAllReferences(organizationId, provider);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
