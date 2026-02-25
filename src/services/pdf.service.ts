import { fromBuffer } from "pdf2pic";
import { PDFParse } from "pdf-parse";

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

/**
 * Converts a PDF buffer into screenshots, extracted text, metadata, and tabular data.
 * Note: pdf-parse is used for text and metadata. pdf2pic is used for screenshots.
 * Tabular extraction is limited by pdf-parse capabilities.
 */
export async function pdfConvert(buffer: Buffer, jobId: string) {
  try {
    const parser = new PDFParse({ data: buffer });
    const textData = await parser.getText();
    const infoData = await parser.getInfo();
    const tableData = await parser.getTable();
    const images = await pdfToImages(buffer, jobId);

    return {
      text: textData.text,
      metadata: infoData.info,
      pages: infoData.total,
      images: images,
      tabular: tableData
    };

  } catch (error: any) {
    throw new Error(`PDF conversion failed: ${error.message || String(error)}`);
  }
}
