import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppContext } from "./app-context.js";
import { createHttpApp } from "./http-app.js";
import { defaultDataRoot } from "./paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${PORT}`;
const dataRoot = defaultDataRoot(process.env.ETSY_ASSISTANT_HOME);

const ctx = createAppContext({
  dataRoot,
  publicOrigin,
});

const app = createHttpApp(ctx);

const distDir = path.join(__dirname, "../../dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Etsy Listing Assistant listening on ${publicOrigin}`);
  console.log(`Local data directory: ${dataRoot}`);
});
