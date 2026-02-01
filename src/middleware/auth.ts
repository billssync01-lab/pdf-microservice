import { Request, Response, NextFunction } from "express";

export function auth(req: Request, res: Response, next: NextFunction) {
  const key = req.headers.authorization?.replace("Bearer ", "");
  console.log("key", key)
  if (!key) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
