import { Router } from "express";
import multer from "multer";
import { pdfToImages } from "../services/pdf.service";
import { ocrImages } from "../services/ocr.service";
import { randomUUID } from "crypto";

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const jobId = randomUUID();
  const images = await pdfToImages(req.file.buffer, jobId);
  // const text = await ocrImages(images);

  res.json({
    success: true,
    pages: images.length,
    // text
  });
});

export default router;
