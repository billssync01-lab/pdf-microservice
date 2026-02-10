import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ExpenseType = "general" | "mileage";

export async function builder(
  category: string,
  expenseType: ExpenseType,
  documentType: string,
  pageType: string | "single"
) {
  const isAutoCategory = category === "auto-categorize";

  /* ---------------- Base system instruction ---------------- */

  let systemPrompt = `
You are an expense document extraction system.
Your job is to read the document accurately and return ONLY valid JSON.
Do not add explanations, comments, or extra text.
Rules:
 -If a value is missing, return null.
 -If the document is not a valid invoice or receipt return data as {}
- Dates must be in ISO format (YYYY-MM-DD).
- Amount must be numeric
- If type = general → distance & rate = null
- If type = mileage → extract distance & rate if present
- If auto-category → detect the most appropriate category as (Software, Cloud Services, Meals, Travel, Office Supplies, Equipment, Utilities, Transportation, Accommodation, Other miscellaneous expenses)
- If description is not found → create a generic description based on extracted data
- If no is not found → generate a random unique ID
- If lines are found → extract them as well with amount and name and set quantity and unit price if available else set quantity as 1 and unit price to amount
- If lines are not found → set empty array
- If tax and discount are found → include under lineItems as separate items with names as tax and discount separately and set rate as tax or discount amount and quantity as 1
- If currency is not found → get the location currency based on the address
- If shipping address is not found → use billing address instead
- If billing address is not found → set it to null
  `.trim();

  /* ---------------- Category logic ---------------- */
  const categoryInstruction = isAutoCategory
    ? `
Automatically determine the most appropriate expense category
(Software, Cloud Services, Meals, Travel, Office Supplies, Equipment, Utilities, Transportation, Accommodation, miscellaneous expenses).
      `.trim()
    : `
Use the provided expense category exactly as given:
"${category}".
Do NOT change or infer another category.
      `.trim();

  /* ---------------- Expense type logic ---------------- */

  let expenseTypeInstruction = "";

  if (expenseType === "mileage") {
    expenseTypeInstruction = `
This is a mileage expense.
Extract:
- trip_date
- start_location
- end_location
- distance
- unit (km or miles)
- rate_per_unit (if present)
- total_amount
    `.trim();
  } else {
    expenseTypeInstruction = `This is a general expense.
Extract:
- merchant_name
- transaction_date
- total_amount
- tax_amount (if present)
- payment_method (if present)
- currency
    `.trim();
  }
  /* ---------------- page type logic ---------------- */
  let pageTypeInstruction = "";

  if (pageType === "single") {
    pageTypeInstruction = `
You are an expert document aggregation system.

You are given document/image from a single page or multiple pages
of the SAME document.

Rules:
- This is ONE document, not multiple.
- Header fields usually appear on the FIRST page.
    `.trim();
  } else {
    pageTypeInstruction = `
You are an expert document aggregation system.
You are given document/image with multiple pages in one document.

Rules:
- This is different document per page, not single.
- Header fields usually appear on the FIRST page.
    `.trim();
  }

  /* ---------------- Document type logic ---------------- */

  let documentTypeInstruction = "";

  switch (documentType) {
    case "receipt":
      documentTypeInstruction = `
The document is a receipt.
Line items may be present.
Focus on totals, taxes, discounts and merchant details.
      `.trim();
      break;

    case "invoice":
      documentTypeInstruction = `
The document is an invoice.
Extract invoice_number, due_date, customer_name, billing_address and line_items, discount, tax if available.
      `.trim();
      break;

    case "mileage-log":
      documentTypeInstruction = `
The document is a mileage log.
Each trip may be listed separately.
      `.trim();
      break;

    default:
      documentTypeInstruction = `
This is a general expense.
Extract:
- merchant_name
- transaction_date
- total_amount
- tax_amount (if present)
- payment_method (if present)
- currency
      `.trim();
  }

  /* ---------------- Output schema ---------------- */

  const outputSchema = `
Return Return STRICT JSON only in the following structure:

{
  "document_type": "${documentType || "unknown"}",
  "expense_type": "${expenseType}",
  "category": ${isAutoCategory ? `"auto"` : `"${category}"`},
  "confidence": number,
  "total_pages": number | 1,
  "data": {
  "no": string | null,
  "date": string | null,
  "amount": number | null,
  "name": string | null,
  "category": string,
  "description": string | null,
  "distance": number | null,
  "rate": number | null,
  "currency": string | null,
  lineItems: Array<{
    name: string | null,
    amount: number | null,
    quantity?: number | null,
    unitPrice?: number | null,
  }>,
  "shippingAddress": string | null,
  "billingAddress": string | null,
  "discount": number | null,
  "tax": number | null,
  "tax percentage": number | null,
  "note": string | null,
  "payment_method": string | null,
  "payment_status": string | null,
  "invoice_number": string | null,
  "due_date": string | null,
  "terms_and_conditions": string | null,
  "notes": string | null,
  }
}
  `.trim();

  /* ---------------- Final prompt ---------------- */

  const prompt = [
    systemPrompt,
    categoryInstruction,
    expenseTypeInstruction,
    documentTypeInstruction,
    outputSchema,
  ].join("\n\n");

  return prompt;
}

export async function extractWithVision(
  imageBuffer: Buffer,
  prompt: string,
  type: string
) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "text", text: `Type: ${type}` },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
            },
          },
        ],
      },
    ],
  });

  return JSON.parse(res.choices[0].message.content!);
}
