import express from "express";
import cors from "cors";
import type { AppContext } from "./app-context.js";
import { createMediaRouter, createRouter } from "./routes.js";

export function createHttpApp(ctx: AppContext) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));
  app.use("/api", createRouter(ctx));
  app.use("/media", createMediaRouter(ctx));
  return app;
}
