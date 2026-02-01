import { Router } from "express";
import multer from "multer";
import { processPDF } from "../services/pdf.service";

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const result = await processPDF(req.file.buffer);

  res.json({
    success: true,
    pages: result.pages,
    text: result.text
  });
});

export default router;
