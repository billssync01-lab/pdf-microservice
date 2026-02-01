import express from "express";
import cors from "cors";
import processRoute from "./routes/process";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/process", processRoute);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 PDF microservice running on ${PORT}`);
});
