import { db } from "../db";
import { teams, transactions, Integrations } from "../schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { JobService } from "../sync/job.service";

const jobService = new JobService();

export async function runAutomationCron() {
  console.log("Running automation cron...");
  
  // Find teams with automation enabled
  const teamsWithAutomation = await db.query.teams.findMany({
    where: sql`${teams.settings}->>'enableAutomation' = 'true'`,
  });

  for (const team of teamsWithAutomation) {
    try {
      // Find integrations for this team
      const integrations = await db.query.Integrations.findMany({
        where: eq(Integrations.organizationId, team.id),
      });

      for (const integration of integrations) {
        console.log(`Checking unsynced transactions for team ${team.name} (${integration.provider})...`);
        
        // Find unsynced transactions for this team
        const unsynced = await db.query.transactions.findMany({
          where: and(
            eq(transactions.status, "ready"),
            isNull(transactions.externalId),
            // eq(transactions.organizationId, team.id) // Need to add organizationId to transactions table
          ),
        });

        if (unsynced.length > 0) {
          console.log(`Creating bulk sync job for team ${team.id} (${unsynced.length} items)...`);
          await jobService.createSyncJob({
            userId: team.ownerId || 0,
            organizationId: team.id,
            platform: integration.provider,
            transactionIds: unsynced.map(t => t.id),
          });
        }
      }
    } catch (err) {
      console.error(`Automation failed for team ${team.id}:`, err);
    }
  }
}

// Run every 2 hours
setInterval(runAutomationCron, 2 * 60 * 60 * 1000);
runAutomationCron();
