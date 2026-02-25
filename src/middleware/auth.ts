import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger";

export function auth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    logger.info({ Header: authHeader }, "Invalid authorization header")
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  logger.info({ Token: token }, "Fetched token from authheader")

  if (token !== process.env.API_KEY) {
    logger.info({ Token: token }, "Invalid authorization token or apikey")
    return res.status(403).json({ error: "Invalid API key" });
  }

  next();
}
