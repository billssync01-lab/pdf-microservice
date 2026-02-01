import { createWorker } from "tesseract.js";

export async function ocrImages(images: string[]) {
  const worker = await createWorker("eng");
  let text = "";

  for (const img of images) {
    const result = await worker.recognize(img);
    text += result.data.text + "\n";
  }

  await worker.terminate();
  return text;
}
