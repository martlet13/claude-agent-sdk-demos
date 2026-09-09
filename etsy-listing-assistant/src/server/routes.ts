import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import multer from "multer";
import { STARTER_PRESETS } from "../shared/presets.js";
import { searchTaxonomy } from "../shared/taxonomy.js";
import { validatePublishRequest } from "../shared/validation.js";
import type { ListingCopy, PublishRequest } from "../shared/types.js";
import {
  beginOauth,
  createEtsyClient,
  defaultRedirectUri,
  finishOauth,
  type AppContext,
} from "./app-context.js";
import { templateFromListing } from "./templates.js";

function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found/i.test(message) ? 404 : /rate-limited/i.test(message) ? 429 : 400;
      res.status(status).json({ error: message });
    });
  };
}

export function createRouter(ctx: AppContext): Router {
  const router = express.Router();

  const imageUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = ctx.packs.imagesDir(String(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".png";
        cb(null, `import-${randomUUID()}${ext}`);
      },
    }),
  });

  const fileUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = ctx.packs.filesDir(String(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".bin";
        cb(null, `file-${randomUUID()}${ext}`);
      },
    }),
  });

  const generateUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(ctx.dataRoot, "tmp", "references");
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || ".png";
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { files: 8, fileSize: 12 * 1024 * 1024 },
  });

  router.get(
    "/status",
    asyncHandler(async (_req, res) => {
      const creds = ctx.credentials.publicStatus();
      const templateCount = ctx.templates.list().length;
      res.json({
        ...creds,
        templateCount,
        setupComplete: creds.claudeConfigured && creds.etsyConfigured && templateCount > 0,
        presets: STARTER_PRESETS,
        sections: ctx.settings.loadSections(),
        recentTaxonomy: ctx.settings.read().recentTaxonomy,
        defaultRedirectUri: defaultRedirectUri(ctx.publicOrigin),
        risks: {
          claude:
            "Generation uses your own Claude / Anthropic credentials on this computer. Web-UI automation is not used in v1; official API access remains subject to Anthropic terms.",
          etsy:
            "All Etsy API calls leave from this machine with your own developer app. Listings are created as drafts only. You review and activate them in Etsy Seller Manager. Usage remains subject to Etsy Open API terms.",
        },
      });
    }),
  );

  router.post(
    "/setup/claude",
    asyncHandler(async (req, res) => {
      const apiKey = String(req.body?.apiKey ?? "").trim();
      if (!apiKey) throw new Error("Paste your Anthropic API key.");
      ctx.credentials.update((vault) => ({ ...vault, claude: { apiKey } }));
      res.json({ ok: true, claudeConfigured: true });
    }),
  );

  router.post(
    "/setup/etsy-app",
    asyncHandler(async (req, res) => {
      const keystring = String(req.body?.keystring ?? "").trim();
      const sharedSecret = String(req.body?.sharedSecret ?? "").trim();
      const redirectUri = String(req.body?.redirectUri ?? defaultRedirectUri(ctx.publicOrigin)).trim();
      if (!keystring || !sharedSecret) {
        throw new Error("Both Etsy keystring and shared secret are required.");
      }
      ctx.credentials.update((vault) => ({
        ...vault,
        etsy: {
          keystring,
          sharedSecret,
          redirectUri,
          tokens: vault.etsy?.tokens,
        },
      }));
      res.json({ ok: true, redirectUri });
    }),
  );

  router.post(
    "/setup/etsy-disconnect",
    asyncHandler(async (_req, res) => {
      ctx.credentials.update((vault) => {
        if (!vault.etsy) return vault;
        return {
          ...vault,
          etsy: {
            keystring: vault.etsy.keystring,
            sharedSecret: vault.etsy.sharedSecret,
            redirectUri: vault.etsy.redirectUri,
          },
        };
      });
      res.json({ ok: true, etsyConfigured: false });
    }),
  );

  router.post(
    "/etsy/oauth/start",
    asyncHandler(async (req, res) => {
      const saved = ctx.credentials.read().etsy?.redirectUri;
      const redirectUri = String(
        req.body?.redirectUri || saved || defaultRedirectUri(ctx.publicOrigin),
      ).trim();
      const started = beginOauth(ctx, redirectUri);
      res.json(started);
    }),
  );

  router.get(
    "/etsy/oauth/callback",
    asyncHandler(async (req, res) => {
      const error = req.query.error ? String(req.query.error) : "";
      if (error) {
        res.status(400).send(oauthResultPage(`Etsy returned ${error}. You can close this tab and retry Connect.`));
        return;
      }
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      await finishOauth(ctx, code, state);
      res.send(oauthResultPage("Etsy connected. You can close this tab and return to the assistant."));
    }),
  );

  router.post(
    "/generate",
    generateUpload.array("references", 8),
    asyncHandler(async (req, res) => {
      const files = (Array.isArray(req.files) ? req.files : []) as Array<{
        path: string;
        originalname: string;
      }>;
      const job = ctx.jobs.start(
        {
          theme: String(req.body?.theme ?? ""),
          ideaCount: Number(req.body?.ideaCount ?? 4),
          aspectRatio: req.body?.aspectRatio ?? "1:1",
          presetId: String(req.body?.presetId ?? "wall-art"),
          advancedPrompt: req.body?.advancedPrompt,
        },
        {
          referenceImages: files.map((file) => ({
            absPath: file.path,
            originalName: file.originalname,
          })),
        },
      );
      res.status(202).json(job);
    }),
  );

  router.get(
    "/jobs",
    asyncHandler(async (_req, res) => {
      res.json(ctx.jobs.list());
    }),
  );

  router.get(
    "/jobs/:id",
    asyncHandler(async (req, res) => {
      res.json(ctx.jobs.get(req.params.id));
    }),
  );

  router.post(
    "/jobs/:id/cancel",
    asyncHandler(async (req, res) => {
      res.json(ctx.jobs.cancel(req.params.id));
    }),
  );

  router.get(
    "/packs",
    asyncHandler(async (_req, res) => {
      res.json(ctx.packs.list());
    }),
  );

  router.get(
    "/packs/:id",
    asyncHandler(async (req, res) => {
      res.json({
        pack: ctx.packs.read(req.params.id),
        validation: ctx.packs.validate(req.params.id),
        folder: ctx.packs.packDir(req.params.id),
      });
    }),
  );

  router.patch(
    "/packs/:id/copy",
    asyncHandler(async (req, res) => {
      const copy = req.body as ListingCopy;
      res.json(ctx.packs.updateCopy(req.params.id, {
        title: String(copy.title ?? ""),
        description: String(copy.description ?? ""),
        tags: Array.isArray(copy.tags) ? copy.tags.map(String) : [],
      }));
    }),
  );

  router.patch(
    "/packs/:id/images",
    asyncHandler(async (req, res) => {
      res.json(ctx.packs.updateImages(req.params.id, req.body?.images ?? []));
    }),
  );

  router.post(
    "/packs/:id/open",
    asyncHandler(async (req, res) => {
      const folder = ctx.packs.packDir(req.params.id);
      if (!fs.existsSync(folder)) throw new Error("Listing pack folder was not found.");
      openLocalFolder(folder);
      res.json({ folder });
    }),
  );

  router.patch(
    "/packs/:id/commerce",
    asyncHandler(async (req, res) => {
      res.json(ctx.packs.updateCommerce(req.params.id, req.body ?? {}));
    }),
  );

  router.post(
    "/packs/:id/images",
    imageUpload.single("image"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new Error("Choose an image to import.");
      res.json(
        ctx.packs.addImportedImage(req.params.id, req.file.filename, req.file.originalname),
      );
    }),
  );

  router.post(
    "/packs/:id/files",
    fileUpload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new Error("Choose a digital file to add.");
      res.json(
        ctx.packs.addDigitalFile(req.params.id, req.file.filename, req.file.originalname),
      );
    }),
  );

  router.get(
    "/templates",
    asyncHandler(async (_req, res) => {
      res.json(ctx.templates.list());
    }),
  );

  router.post(
    "/templates",
    asyncHandler(async (req, res) => {
      const listingId = Number(req.body?.listingId);
      if (!Number.isInteger(listingId) || listingId <= 0) {
        throw new Error("Enter a listing ID from your own shop.");
      }
      const client = createEtsyClient(ctx);
      const listing = await client.getListing(listingId);
      const template = ctx.templates.add(
        templateFromListing(listing, req.body?.name),
      );
      res.status(201).json(template);
    }),
  );

  router.patch(
    "/templates/:id",
    asyncHandler(async (req, res) => {
      res.json(ctx.templates.rename(req.params.id, String(req.body?.name ?? "")));
    }),
  );

  router.delete(
    "/templates/:id",
    asyncHandler(async (req, res) => {
      ctx.templates.delete(req.params.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/etsy/sections/refresh",
    asyncHandler(async (_req, res) => {
      const sections = await createEtsyClient(ctx).listSections();
      ctx.settings.saveSections(sections);
      res.json(sections);
    }),
  );

  router.get(
    "/etsy/taxonomy",
    asyncHandler(async (req, res) => {
      const query = String(req.query.q ?? "");
      let nodes = ctx.settings.loadTaxonomy();
      if (nodes.length === 0) {
        nodes = await createEtsyClient(ctx).fetchTaxonomyTree();
        ctx.settings.saveTaxonomy(nodes);
      }
      res.json(searchTaxonomy(query, nodes));
    }),
  );

  router.post(
    "/etsy/taxonomy/recent",
    asyncHandler(async (req, res) => {
      const hit = req.body;
      if (!hit?.id || !hit?.name) throw new Error("Taxonomy id and name are required.");
      res.json(ctx.settings.rememberTaxonomy(hit));
    }),
  );

  router.post(
    "/publish",
    asyncHandler(async (req, res) => {
      const request = req.body as PublishRequest;
      const pack = ctx.packs.read(request.packId);
      const template = ctx.templates.get(request.templateId);
      const merged: PublishRequest = {
        packId: request.packId,
        templateId: request.templateId,
        shopSectionId: request.shopSectionId ?? template.shopSectionId,
        taxonomyId: Number(request.taxonomyId || template.taxonomyId || 0),
        price: Number(request.price ?? pack.price),
        quantity: Number(request.quantity ?? pack.quantity),
        listingType: request.listingType ?? template.listingType ?? pack.listingType,
      };
      const check = validatePublishRequest(merged, {
        ...pack,
        price: merged.price,
        quantity: merged.quantity,
        listingType: merged.listingType,
      });
      if (!check.ok) {
        res.status(400).json({ error: "Pack is not ready to publish.", issues: check.issues });
        return;
      }
      if (merged.listingType === "physical" && !template.shippingProfileId) {
        throw new Error(
          "This physical template has no shipping profile. Clone a listing from your shop that already has shipping configured.",
        );
      }
      ctx.settings.rememberTaxonomy({
        id: merged.taxonomyId,
        name: `Taxonomy ${merged.taxonomyId}`,
        path: String(merged.taxonomyId),
      });
      const result = await createEtsyClient(ctx).createDraft({
        title: pack.copy.title,
        description: pack.copy.description,
        tags: pack.copy.tags,
        price: merged.price,
        quantity: merged.quantity,
        taxonomyId: merged.taxonomyId,
        listingType: merged.listingType,
        whoMade: template.whoMade,
        whenMade: template.whenMade,
        isSupply: template.isSupply,
        shopSectionId: merged.shopSectionId,
        shippingProfileId: template.shippingProfileId,
        readinessStateId: template.readinessStateId,
        returnPolicyId: template.returnPolicyId,
        processingMin: template.processingMin,
        processingMax: template.processingMax,
        imagePaths: ctx.packs.includedImagePaths(pack),
        digitalFilePaths:
          merged.listingType === "download" ? ctx.packs.digitalFilePaths(pack) : [],
      });
      res.json(result);
    }),
  );

  return router;
}

export function createMediaRouter(ctx: AppContext): Router {
  const router = express.Router();
  router.get("/packs/:id/images/:filename", (req, res) => {
    try {
      const file = ctx.packs.imageAbsPath(req.params.id, req.params.filename);
      if (!fs.existsSync(file)) {
        res.status(404).end();
        return;
      }
      res.sendFile(file);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  return router;
}

function openLocalFolder(folder: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(command, [folder], () => {
    // Opening a folder is best-effort on headless environments.
  });
}

function oauthResultPage(message: string): string {
  return `<!doctype html>
<html><body style="font-family: Georgia, serif; padding: 48px; background: #f6efe4; color: #1c1917;">
  <h1>Etsy Listing Assistant</h1>
  <p>${message}</p>
</body></html>`;
}
