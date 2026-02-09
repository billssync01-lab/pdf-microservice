import { PDFParse } from "pdf-parse";
import { fromBuffer } from "pdf2pic";
import fs from "fs";
import path from "path";

export async function pdfToImages(buffer: Buffer, jobId: string) {
  const parser = new PDFParse({ data: buffer });
  const info = await parser.getInfo();
  const totalPages = info.total;

  await parser.destroy();

  const outputDir = path.join("/tmp", jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const converter = fromBuffer(buffer, {
    density: 200,
    format: "png",
    savePath: outputDir,
    saveFilename: "page",
  });

  const imagePaths: string[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const result = await converter(page);

    if (!result.path) {
      throw new Error(`Failed to render page ${page}`);
    }

    imagePaths.push(result.path);
  }

  return imagePaths;
}
