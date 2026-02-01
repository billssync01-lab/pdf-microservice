import pdf from "pdf-parse";

export async function processPDF(buffer: Buffer) {
  const data = await pdf(buffer);

  return {
    pages: data.numpages,
    text: data.text
  };
}
