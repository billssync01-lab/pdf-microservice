import path from "path";
import fs from "fs";
import { execSync } from "child_process";
const pdfPoppler = require("pdf-poppler");

export function getPdfTotalPages(pdfPath: string): number {
  try {
    const output = execSync(`pdfinfo "${pdfPath}"`).toString();
    const match = output.match(/Pages:\s+(\d+)/);
    if (!match) throw new Error("Could not detect total pages");
    return Number(match[1]);
  } catch (error) {
    throw new Error("Could not detect total pages: " + (error as Error).message);
  }
}

async function convertPdfPage(pdfPath: string, outputDir: string, pageNumber: number): Promise<string> {
  const options = {
    format: "png",
    out_dir: outputDir,
    out_prefix: `page_${pageNumber}`,
    page: pageNumber,
    dpi: 300,
  };

  await pdfPoppler.convert(pdfPath, options);

  // pdf-poppler outputs: page_1-1.png (weird suffix)
  return path.join(outputDir, `page_${pageNumber}-${pageNumber}.png`);
}

export async function pdfToImagesPoppler(buffer: Buffer, jobId: string): Promise<string[]> {
  const tempDir = path.join("/tmp", jobId);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const pdfPath = path.join(tempDir, "input.pdf");
  fs.writeFileSync(pdfPath, buffer);

  const totalPages = getPdfTotalPages(pdfPath);
  const imagePaths: string[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const imagePath = await convertPdfPage(pdfPath, tempDir, page);
    imagePaths.push(imagePath);
  }

  return imagePaths;
}
