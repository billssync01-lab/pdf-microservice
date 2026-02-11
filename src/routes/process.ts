import { Router } from "express";
import multer from "multer";
import { pdfToImages } from "../services/pdf.service";
import { randomUUID } from "crypto";
import { auth } from "../middleware/auth";
import logger from "../utils/logger";

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", auth, upload.single("file"), async (req, res) => {
  logger.info("Process request started")
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const jobId = randomUUID();
  logger.info({ jobId }, "Process request jobid created")
  const images = await pdfToImages(req.file.buffer, jobId);
  logger.info({ images }, "Process request ended")

  res.json({
    success: true,
    pages: images.length,
    images: images
  });
});

export default router;
