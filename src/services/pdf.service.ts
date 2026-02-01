import { fromBuffer } from "pdf2pic";
import fs from "fs";
import path from "path";

export async function pdfToImages(buffer: Buffer, jobId: string) {
  const outputDir = path.join("tmp", jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const convert = fromBuffer(buffer, {
    density: 200,
    format: "png",
    savePath: outputDir,
  });

  const pages = await convert.bulk(-1);
  return pages.map(p => p.path);
}
