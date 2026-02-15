import { Response } from 'express';
import logger from './logger';

type Client = {
  id: string;
  teamId: string;
  res: Response;
};

const clients = new Map<string, Client>();

export function addClient(id: string, teamId: string, res: Response) {
  clients.set(id, { id, teamId, res });
  logger.info({ clientId: id, teamId }, "SSE client connected");

  res.on("close", () => {
    clients.delete(id);
    logger.info({ clientId: id, teamId }, "SSE client disconnected");
  });
}

export function broadcastToTeam(teamId: string, event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let count = 0;

  for (const client of clients.values()) {
    if (client.teamId === teamId) {
      client.res.write(payload);
      count++;
    }
  }
  logger.info({ teamId, event, clientCount: count }, "Broadcasted SSE event");
}

export async function notifyStatusUpdate(teamId: string | number, jobId: string | number, status: string, details?: any) {
  try {
    broadcastToTeam(teamId.toString(), 'RECEIPT_UPDATED', {
      jobId,
      status,
      ...details,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error, jobId, status }, "Failed to send SSE notification");
  }
}
