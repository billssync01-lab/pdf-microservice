import axios from 'axios';
import logger from './logger';

const SSE_URL = 'https://billsdeck.com/app/api/sse/notify';

export async function notifyStatusUpdate(userId: number, jobId: string | number, status: string, details?: any) {
  try {
    await axios.post(SSE_URL, {
      userId,
      data: {
        event: 'RECEIPT_UPDATED',
        jobId,
        status,
        ...details,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error({ error, jobId, status }, "Failed to send SSE notification");
  }
}
