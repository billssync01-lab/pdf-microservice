import { Router } from "express";
import { db } from "../db";
import { WebhookEvents, Integrations, contacts, Inventory } from "../schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { ReferenceDataService } from "../sync/reference.service";
import { QuickBooksAdapter } from "../sync/adapters/quickbooks.adapter";
import { XeroAdapter } from "../sync/adapters/xero.adapter";
import { ZohoAdapter } from "../sync/adapters/zoho.adapter";

const router = Router();
const referenceService = new ReferenceDataService();

router.post("/quickbooks", async (req, res) => {
  const signature = req.headers["intuit-signature"];
  const verifier = process.env.QUICKBOOKS_WEBHOOK_VERIFIER;
  
  if (verifier && signature) {
    const hash = crypto.createHmac("sha256", verifier).update(JSON.stringify(req.body)).digest("base64");
    if (hash !== signature) return res.status(401).send("Invalid signature");
  }

  const { eventNotifications } = req.body;
  for (const notification of eventNotifications) {
    const realmId = notification.realmId;
    const integration = await db.query.Integrations.findFirst({ where: eq(Integrations.realmId, realmId) });
    if (!integration) continue;

    for (const entity of notification.dataChangeEvent.entities) {
      await db.insert(WebhookEvents).values({
        platform: "quickbooks",
        organizationId: integration.organizationId!,
        eventType: entity.operation,
        entityId: entity.id,
        payload: entity,
      });
      // Trigger lazy sync or direct fetch for this ID
      if (entity.name === "Vendor" || entity.name === "Customer") {
        await referenceService.syncContacts(integration.organizationId!, new QuickBooksAdapter(integration));
      } else if (entity.name === "Item") {
        await referenceService.syncProducts(integration.organizationId!, new QuickBooksAdapter(integration));
      }
    }
  }
  res.send("OK");
});

router.post("/xero", async (req, res) => {
  const signature = req.headers["x-xero-signature"];
  const verifier = process.env.XERO_WEBHOOK_VERIFIER;
  
  if (verifier && signature) {
    const hash = crypto.createHmac("sha256", verifier).update(JSON.stringify(req.body)).digest("base64");
    if (hash !== signature) return res.status(401).send("Invalid signature");
  }

  // Handle Xero events
  res.send("OK");
});

router.post("/zoho", async (req, res) => {
  // Zoho Books webhooks implementation
  res.send("OK");
});

export default router;
