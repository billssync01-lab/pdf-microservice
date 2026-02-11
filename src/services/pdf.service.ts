import { fromBuffer } from "pdf2pic";
import fs from "fs";
import path from "path";

export async function pdfToImages(buffer: Buffer, jobId: string) {
  const outputDir = path.join("/tmp", jobId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const converter = fromBuffer(buffer, {
    density: 200,
    format: "png",
    savePath: outputDir,
    saveFilename: "page",
  });

  const results = await converter.bulk(-1);
  return results.map(result => {
    if (!result.path) {
      throw new Error(`Failed to render page ${result.page}`);
    }
    return result.path;
  });
}
