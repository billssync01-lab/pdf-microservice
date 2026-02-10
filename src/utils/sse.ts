import axios from 'axios';
import logger from './logger';

const SSE_URL = 'http://localhost:3000/api/sse';

export async function notifyStatusUpdate(jobId: string | number, status: string, details?: any) {
  try {
    await axios.post(SSE_URL, {
      jobId,
      status,
      details,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ error, jobId, status }, "Failed to send SSE notification");
  }
}
