import { Router } from "express";
import multer from "multer";
import { pdfToImagesPoppler } from "../services/poppler.service";
import { randomUUID } from "crypto";
import { auth } from "../middleware/auth";

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", auth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const jobId = randomUUID();
  const images = await pdfToImagesPoppler(req.file.buffer, jobId);

  res.json({
    success: true,
    pages: images.length,
    images: images
  });
});

export default router;
