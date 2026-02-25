import express from "express";
import cors from "cors";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import processRoute from "./routes/process";
import syncRoute from "./api/sync";
import webhookRoute from "./api/webhooks";
import { addClient } from "./utils/sse";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use("/process", processRoute);
app.use("/sync", syncRoute);
app.use("/webhooks", webhookRoute);

app.get("/events", (req, res) => {
  const token = req.query.token as string;
  const teamId = req.query.teamId as string;

  let finalTeamId = teamId;

  // Security: If token is provided, verify it and extract teamId
  if (token) {
    try {
      const secret = process.env.AUTH_SECRET || "";
      const decoded = jwt.verify(token, secret) as any;
      // Depending on how the token is structured in the Next.js app
      // The session data had { user: { id: ... } }
      // We might need to fetch the organizationId for this user or have it in the token
      if (decoded.organizationId) {
        finalTeamId = decoded.organizationId.toString();
      } else if (decoded.user && decoded.user.organizationId) {
         finalTeamId = decoded.user.organizationId.toString();
      }
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  if (!finalTeamId) {
    return res.status(400).json({ error: "teamId or valid token required" });
  }

  const clientId = crypto.randomBytes(16).toString("hex");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`event: connected\ndata: {}\n\n`);

  addClient(clientId, finalTeamId, res);

  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: {}\n\n`);
  }, 20000);

  req.on("close", () => {
    clearInterval(keepAlive);
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 PDF microservice running on ${PORT}`);
});
