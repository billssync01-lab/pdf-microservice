// import { PDFParse } from "pdf-parse";
import { fromBuffer } from "pdf2pic";
// import fs from "fs";
// import path from "path";

// export async function pdfToImages(buffer: Buffer, jobId: string) {
//   const parser = new PDFParse({ data: buffer });
//   const info = await parser.getInfo();
//   const totalPages = info.total;

//   await parser.destroy();

//   const outputDir = path.join("/tmp", jobId);
//   fs.mkdirSync(outputDir, { recursive: true });

//   const converter = fromBuffer(buffer, {
//     density: 200,
//     format: "png",
//     savePath: outputDir,
//     saveFilename: "page",
//   });

//   const results = await converter.bulk(-1);
//   return results.map(result => {
//     if (!result.path) {
//       throw new Error(`Failed to render page ${result.page}`);
//     }
//     return result.path;
//   });
// }
export async function pdfToImages(buffer: Buffer, jobId: string): Promise<string[]> {
  const converter = fromBuffer(buffer, {
    density: 200,
    format: "png",
    preserveAspectRatio: true,
    width: 768,
  });

  // bulk(-1) processes all pages; { responseType: "base64" } returns strings instead of saving files
  const results = await converter.bulk(-1, { responseType: "base64" });

  return results.map(result => {
    if (!result.base64) {
      throw new Error(`Failed to render page ${result.page} to base64`);
    }
    return result.base64;
  });
}
