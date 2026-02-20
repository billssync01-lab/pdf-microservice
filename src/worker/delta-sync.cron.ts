import { db } from "../db";
import { Integrations, teams } from "../schema";
import { eq, and, sql, lt } from "drizzle-orm";
import { ReferenceDataService } from "../sync/reference.service";
import { QuickBooksAdapter } from "../sync/adapters/quickbooks.adapter";
import { XeroAdapter } from "../sync/adapters/xero.adapter";
import { ZohoAdapter } from "../sync/adapters/zoho.adapter";

const referenceService = new ReferenceDataService();

export async function runDeltaSyncCron() {
  console.log("Running delta sync cron (6-hour interval)...");
  
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  
  const activeIntegrations = await db.query.Integrations.findMany({
    where: lt(Integrations.updatedAt, sixHoursAgo),
  });

  for (const integration of activeIntegrations) {
    try {
      const adapter = getAdapter(integration.provider, integration);
      const orgId = integration.organizationId!;
      
      console.log(`Syncing delta for org ${orgId} (${integration.provider})...`);
      
      const lastSync = integration.updatedAt || sixHoursAgo;
      
      await referenceService.syncContacts(orgId, adapter, lastSync);
      await referenceService.syncProducts(orgId, adapter, lastSync);
      await referenceService.syncAccounts(orgId, adapter);
      
      await db.update(Integrations).set({ updatedAt: new Date() }).where(eq(Integrations.id, integration.id));
    } catch (err) {
      console.error(`Delta sync failed for integration ${integration.id}:`, err);
    }
  }
}

function getAdapter(platform: string, integration: any) {
  switch (platform.toLowerCase()) {
    case "quickbooks": return new QuickBooksAdapter(integration);
    case "xero": return new XeroAdapter(integration);
    case "zoho":
    case "zohobooks": return new ZohoAdapter(integration);
    default: throw new Error(`Unsupported platform: ${platform}`);
  }
}

// Run every 6 hours
setInterval(runDeltaSyncCron, 6 * 60 * 60 * 1000);
runDeltaSyncCron();
