import { Router } from "express";
import { getJob } from "../services/job.service";

const router = Router();

router.get("/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
});

export default router;
