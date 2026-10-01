import { useCallback, useEffect, useMemo, useState } from "react";
import { ETSY_LIMITS } from "../shared/etsy-limits";
import { variationSummary } from "../shared/inventory";
import type {
  AspectRatio,
  DraftPublishResult,
  ListingCopy,
  ListingPackManifest,
  ListingType,
  PublishLogEntry,
  PublishTemplate,
  ShopSection,
  TaxonomyHit,
} from "../shared/types";
import { api, imageUrl, type AppStatus, type GenerationJob } from "./client-api";

type Page = "setup" | "generate" | "pack" | "publish" | "templates" | "history";

const PAGES: Array<{ id: Page; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "generate", label: "Generate" },
  { id: "pack", label: "Pack" },
  { id: "publish", label: "Publish" },
  { id: "templates", label: "Templates" },
  { id: "history", label: "History" },
];

export default function App() {
  const [page, setPage] = useState<Page>("setup");
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState("");
  const [packId, setPackId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await api.status();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [refresh]);

  useEffect(() => {
    if (!status) return;
    if (page === "generate" && !status.claudeConfigured) setPage("setup");
    if (page === "publish" && (!status.etsyConfigured || status.templateCount === 0)) {
      setPage("setup");
    }
    if (page === "templates" && !status.etsyConfigured) setPage("setup");
  }, [status, page]);

  if (!status) {
    return (
      <div className="min-h-screen grid place-items-center font-sans">
        <div className="max-w-md space-y-3 text-center">
          <p>Loading local workspace…</p>
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans">
      <header className="border-b border-stone-300/70 bg-[#fbf6ee]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="font-display text-2xl font-semibold tracking-tight">Listing Assistant</p>
            <p className="text-sm text-stone-600">Generate locally. Create Etsy drafts from this computer.</p>
          </div>
          <div className="flex gap-2 text-xs">
            <Pill ok={status.claudeConfigured} label="Claude" />
            <Pill ok={status.etsyConfigured} label={status.etsyShopName || "Etsy"} />
            <Pill ok={status.templateCount > 0} label={`${status.templateCount} templates`} />
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-6 pb-3">
          {PAGES.map((item) => {
            const locked =
              (item.id === "generate" && !status.claudeConfigured) ||
              (item.id === "publish" && (!status.etsyConfigured || status.templateCount === 0)) ||
              (item.id === "templates" && !status.etsyConfigured);
            return (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                disabled={locked && item.id !== "setup"}
                className={`rounded-full px-4 py-1.5 text-sm ${
                  page === item.id ? "bg-ink text-paper" : "text-stone-700 hover:bg-stone-200/70"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}
        {page === "setup" && <SetupPage status={status} onChange={refresh} setError={setError} />}
        {page === "generate" && (
          <GeneratePage
            status={status}
            setError={setError}
            onPack={(id) => {
              setPackId(id);
              setPage("pack");
            }}
          />
        )}
        {page === "pack" && (
          <PackPage
            packId={packId}
            setPackId={setPackId}
            setError={setError}
            onPublish={() => setPage("publish")}
          />
        )}
        {page === "publish" && (
          <PublishPage
            status={status}
            packId={packId}
            setError={setError}
            onRefresh={refresh}
          />
        )}
        {page === "templates" && <TemplatesPage setError={setError} onChange={refresh} />}
        {page === "history" && <HistoryPage status={status} setError={setError} />}
      </main>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 ${
        ok ? "bg-lime-100 text-lime-900" : "bg-amber-100 text-amber-900"
      }`}
    >
      {ok ? "●" : "○"} {label}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

function inputClass() {
  return "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-clay";
}

function SetupPage({
  status,
  onChange,
  setError,
}: {
  status: AppStatus;
  onChange: () => Promise<AppStatus>;
  setError: (value: string) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [keystring, setKeystring] = useState("");
  const [sharedSecret, setSharedSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState(status.defaultRedirectUri);
  const [listingId, setListingId] = useState("");
  const [templateName, setTemplateName] = useState("");

  async function wrap(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="font-display text-2xl">First-run setup</h2>
        <p className="mt-2 max-w-2xl text-sm text-stone-600">
          Credentials stay encrypted under your user profile. This app does not proxy Claude or Etsy
          traffic through a vendor server.
        </p>
        <ol className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <li
            className={`rounded-xl p-4 ${
              status.claudeConfigured ? "bg-lime-50 text-lime-950" : "bg-paper"
            }`}
          >
            1. Save your Claude API key
            {status.claudeConfigured ? " — done" : ""}
          </li>
          <li
            className={`rounded-xl p-4 ${
              status.etsyConfigured ? "bg-lime-50 text-lime-950" : "bg-paper"
            }`}
          >
            2. Connect your own Etsy developer app
            {status.etsyConfigured ? " — done" : ""}
          </li>
          <li
            className={`rounded-xl p-4 ${
              status.templateCount > 0 ? "bg-lime-50 text-lime-950" : "bg-paper"
            }`}
          >
            3. Clone one listing as a publish template
            {status.templateCount > 0 ? " — done" : ""}
          </li>
        </ol>
        <p className="mt-3 text-xs text-stone-500">
          You can generate listing copy as soon as Claude is saved. Publishing a draft still needs
          Etsy OAuth and at least one template from your shop.
        </p>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="font-display text-xl">Claude</h3>
        <p className="text-sm text-stone-600">{status.risks.claude}</p>
        <Field label="Anthropic API key" hint="Stored locally and encrypted at rest. Never committed.">
          <input
            type="password"
            className={inputClass()}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status.claudeConfigured ? "Key saved — paste to replace" : "Paste key from console.anthropic.com"}
          />
        </Field>
        <button
          className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
          onClick={() => wrap(() => api.saveClaude(apiKey).then(() => undefined))}
        >
          Save Claude key
        </button>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="font-display text-xl">Etsy developer app</h3>
        <p className="text-sm text-stone-600">{status.risks.etsy}</p>
        <p className="text-sm text-stone-600">
          Create an app at{" "}
          <a className="underline" href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noreferrer">
            etsy.com/developers/your-apps
          </a>
          , register this exact redirect URI, and enable{" "}
          <code>listings_r listings_w shops_r</code>.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Keystring">
            <input className={inputClass()} value={keystring} onChange={(e) => setKeystring(e.target.value)} />
          </Field>
          <Field label="Shared secret">
            <input
              type="password"
              className={inputClass()}
              value={sharedSecret}
              onChange={(e) => setSharedSecret(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Redirect URI" hint="Must match the callback registered on your Etsy app exactly.">
          <input className={inputClass()} value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
            onClick={() =>
              wrap(() => api.saveEtsyApp({ keystring, sharedSecret, redirectUri }).then(() => undefined))
            }
          >
            Save Etsy app
          </button>
          <button
            className="rounded-full border border-stone-400 px-4 py-2 text-sm"
            onClick={() =>
              wrap(async () => {
                if (keystring && sharedSecret) {
                  await api.saveEtsyApp({ keystring, sharedSecret, redirectUri });
                } else if (!status.etsyAppSaved) {
                  throw new Error("Save your Etsy keystring and shared secret first.");
                }
                const started = await api.startOauth(redirectUri);
                window.open(started.authorizeUrl, "_blank", "noopener,width=560,height=720");
              })
            }
          >
            Connect shop (OAuth)
          </button>
          <button className="rounded-full border border-stone-400 px-4 py-2 text-sm" onClick={() => onChange()}>
            I’ve finished authorizing
          </button>
          {status.etsyConfigured && (
            <button
              className="rounded-full border border-stone-400 px-4 py-2 text-sm"
              onClick={() => wrap(() => api.disconnectEtsy().then(() => undefined))}
            >
              Disconnect shop
            </button>
          )}
        </div>
        {status.etsyAppSaved && !status.etsyConfigured && (
          <p className="text-sm text-amber-800">
            App credentials are saved. Click Connect shop — you do not need to paste the secret again.
          </p>
        )}
        {status.etsyConfigured && (
          <p className="text-sm text-sage">Connected{status.etsyShopName ? ` to ${status.etsyShopName}` : ""}.</p>
        )}
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="font-display text-xl">Clone a template from your shop</h3>
        <p className="text-sm text-stone-600">
          Shipping, variations context, and policies come from a listing you already have — never from a
          third-party shop.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Your listing ID">
            <input className={inputClass()} value={listingId} onChange={(e) => setListingId(e.target.value)} />
          </Field>
          <Field label="Template name">
            <input
              className={inputClass()}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Wall art — US shipping"
            />
          </Field>
        </div>
        <button
          className="rounded-full bg-clay px-4 py-2 text-sm text-white"
          onClick={() =>
            wrap(() => api.cloneTemplate(Number(listingId), templateName || undefined).then(() => undefined))
          }
        >
          Clone template
        </button>
      </section>
    </div>
  );
}

function GeneratePage({
  status,
  setError,
  onPack,
}: {
  status: AppStatus;
  setError: (value: string) => void;
  onPack: (id: string) => void;
}) {
  const [presetId, setPresetId] = useState(status.presets[0]?.id ?? "wall-art");
  const preset = status.presets.find((item) => item.id === presetId);
  const [theme, setTheme] = useState(preset?.sampleThemes[0] ?? "");
  const [ideaCount, setIdeaCount] = useState(4);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(preset?.defaultAspectRatio ?? "1:1");
  const [advancedPrompt, setAdvancedPrompt] = useState("");
  const [references, setReferences] = useState<File[]>([]);
  const [job, setJob] = useState<GenerationJob | null>(null);

  useEffect(() => {
    if (!preset) return;
    setAspectRatio(preset.defaultAspectRatio);
  }, [presetId]);

  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "error" || job.status === "cancelled") {
      return;
    }
    const timer = setInterval(async () => {
      const next = await api.job(job.id);
      setJob(next);
      if (next.status === "complete" && next.packId) onPack(next.packId);
    }, 800);
    return () => clearInterval(timer);
  }, [job, onPack]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-display text-2xl">Generate listing content</h2>
        <Field label="Niche preset">
          <select
            className={inputClass()}
            value={presetId}
            onChange={(e) => {
              setPresetId(e.target.value);
              const next = status.presets.find((item) => item.id === e.target.value);
              if (next) setTheme(next.sampleThemes[0] ?? "");
            }}
          >
            {status.presets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-sm text-stone-600">{preset?.description}</p>
        <Field label="Theme / brief">
          <textarea
            className={`${inputClass()} min-h-28`}
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Idea count">
            <input
              type="number"
              min={1}
              max={10}
              className={inputClass()}
              value={ideaCount}
              onChange={(e) => setIdeaCount(Number(e.target.value))}
            />
          </Field>
          <Field label="Aspect ratio">
            <select
              className={inputClass()}
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            >
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
              <option value="3:4">3:4</option>
              <option value="16:9">16:9</option>
            </select>
          </Field>
        </div>
        <Field label="Advanced prompt (optional)">
          <textarea
            className={`${inputClass()} min-h-20`}
            value={advancedPrompt}
            onChange={(e) => setAdvancedPrompt(e.target.value)}
            placeholder="Color story, buyer, or words to avoid"
          />
        </Field>
        <Field
          label="Reference photos (optional)"
          hint="Attached to the pack as listing images. Copy stays faithful to the product in the photos."
        >
          <input
            type="file"
            accept="image/*"
            multiple
            className="block w-full text-sm"
            onChange={(e) => setReferences(Array.from(e.target.files ?? []))}
          />
          {references.length > 0 && (
            <span className="text-xs text-stone-500">{references.length} file(s) selected</span>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full bg-clay px-4 py-2 text-sm text-white"
            onClick={async () => {
              setError("");
              try {
                setJob(
                  await api.generate(
                    { theme, ideaCount, aspectRatio, presetId, advancedPrompt },
                    references,
                  ),
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Run generation
          </button>
          {job && (job.status === "running" || job.status === "queued" || job.status === "cancelling") && (
            <button
              className="rounded-full border border-stone-400 px-4 py-2 text-sm"
              onClick={async () => setJob(await api.cancelJob(job.id))}
            >
              Cancel
            </button>
          )}
        </div>
        {job && (
          <div className="space-y-1 text-sm text-stone-700">
            <p>
              {job.progress}
              {job.error ? ` — ${job.error}` : ""}
            </p>
            {job.log && job.log.length > 1 && (
              <ol className="list-decimal pl-5 text-xs text-stone-500">
                {job.log.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
      <aside className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h3 className="font-display text-xl">Sample themes</h3>
        <ul className="mt-3 space-y-2 text-sm">
          {preset?.sampleThemes.map((sample) => (
            <li key={sample}>
              <button className="text-left underline" onClick={() => setTheme(sample)}>
                {sample}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function PackPage({
  packId,
  setPackId,
  setError,
  onPublish,
}: {
  packId: string | null;
  setPackId: (id: string) => void;
  setError: (value: string) => void;
  onPublish: () => void;
}) {
  const [packs, setPacks] = useState<ListingPackManifest[]>([]);
  const [pack, setPack] = useState<ListingPackManifest | null>(null);
  const [folder, setFolder] = useState("");
  const [issues, setIssues] = useState<string[]>([]);

  const load = useCallback(async (id?: string) => {
    const list = await api.packs();
    setPacks(list);
    const selected = id ?? packId ?? list[0]?.id;
    if (!selected) return;
    setPackId(selected);
    const detail = await api.pack(selected);
    setPack(detail.pack);
    setFolder(detail.folder);
    setIssues(detail.validation.issues.map((issue) => issue.message));
  }, [packId, setPackId]);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  if (!pack) {
    return <p className="text-stone-600">No packs yet. Generate a theme first.</p>;
  }

  const currentPack = pack;
  const copy = currentPack.copy;

  async function persistCopy(next: ListingCopy) {
    setError("");
    try {
      const saved = await api.saveCopy(currentPack.id, next);
      setPack(saved);
      const detail = await api.pack(currentPack.id);
      setIssues(detail.validation.issues.map((issue) => issue.message));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function moveImage(imageId: string, direction: -1 | 1) {
    const sorted = currentPack.images.slice().sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((image) => image.id === imageId);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= sorted.length) return;
    const left = sorted[index];
    const right = sorted[swapWith];
    if (!left || !right) return;
    const next = await api.saveImages(currentPack.id, [
      { id: left.id, order: right.order },
      { id: right.id, order: left.order },
    ]);
    setPack(next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Listing pack">
          <select
            className={inputClass()}
            value={pack.id}
            onChange={(e) => load(e.target.value)}
          >
            {packs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.copy.title || item.theme}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-stone-400 px-4 py-2 text-sm"
            onClick={async () => {
              try {
                const opened = await api.openPackFolder(pack.id);
                setFolder(opened.folder);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Open output folder
          </button>
          <button
            className="rounded-full border border-stone-400 px-4 py-2 text-sm"
            onClick={async () => {
              try {
                const copy = await api.duplicatePack(pack.id);
                await load(copy.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Duplicate pack
          </button>
          <p className="self-center text-xs text-stone-500">On disk: {folder}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-3">
        <h2 className="font-display text-2xl">Listing copy</h2>
        <Field label={`Title (${copy.title.length}/${ETSY_LIMITS.titleMax})`}>
          <input
            className={inputClass()}
            value={copy.title}
            onChange={(e) => setPack({ ...pack, copy: { ...copy, title: e.target.value } })}
            onBlur={(e) => persistCopy({ ...copy, title: e.target.value })}
          />
        </Field>
        <Field label={`Description (${copy.description.length}/${ETSY_LIMITS.descriptionMax})`}>
          <textarea
            className={`${inputClass()} min-h-40`}
            value={copy.description}
            onChange={(e) => setPack({ ...pack, copy: { ...copy, description: e.target.value } })}
            onBlur={(e) => persistCopy({ ...copy, description: e.target.value })}
          />
        </Field>
        <Field label={`Tags (${copy.tags.length}/${ETSY_LIMITS.tagMaxCount}, 20 chars each)`}>
          <input
            className={inputClass()}
            value={copy.tags.join(", ")}
            onChange={(e) =>
              setPack({
                ...pack,
                copy: { ...copy, tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) },
              })
            }
            onBlur={(e) =>
              persistCopy({
                ...copy,
                tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
              })
            }
          />
        </Field>
        <Field
          label={`Materials (${(copy.materials ?? []).length}/${ETSY_LIMITS.materialMaxCount}, optional)`}
        >
          <input
            className={inputClass()}
            value={(copy.materials ?? []).join(", ")}
            placeholder="paper, ink, cotton"
            onChange={(e) =>
              setPack({
                ...pack,
                copy: {
                  ...copy,
                  materials: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                },
              })
            }
            onBlur={(e) =>
              persistCopy({
                ...copy,
                materials: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
              })
            }
          />
        </Field>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">Gallery</h2>
          <label className="cursor-pointer text-sm underline">
            Import image
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPack(await api.importImage(pack.id, file));
              }}
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pack.images
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((image) => (
              <figure key={image.id} className="overflow-hidden rounded-xl border border-stone-200 bg-paper">
                <img src={imageUrl(pack.id, image.filename)} alt={image.alt} className="aspect-square w-full object-cover" />
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={image.included}
                      onChange={async (e) => {
                        const next = await api.saveImages(pack.id, [
                          { id: image.id, included: e.target.checked },
                        ]);
                        setPack(next);
                      }}
                    />
                    Include
                  </label>
                  <span className="flex items-center gap-2">
                    <button className="underline" onClick={() => moveImage(image.id, -1)}>
                      Up
                    </button>
                    <button className="underline" onClick={() => moveImage(image.id, 1)}>
                      Down
                    </button>
                    <span>{image.source}</span>
                  </span>
                </figcaption>
              </figure>
            ))}
        </div>
      </section>

      {pack.listingType === "download" && (
        <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="font-display text-xl">Digital files</h2>
          <ul className="mt-2 text-sm">
            {pack.digitalFiles.map((file) => (
              <li key={file.id}>{file.originalName}</li>
            ))}
          </ul>
          <label className="mt-3 inline-block cursor-pointer text-sm underline">
            Add downloadable file
            <input
              type="file"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPack(await api.importFile(pack.id, file));
              }}
            />
          </label>
        </section>
      )}

      {issues.length > 0 && (
        <ul className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <button className="rounded-full bg-ink px-4 py-2 text-sm text-paper" onClick={onPublish}>
        Continue to create draft
      </button>
    </div>
  );
}

function PublishPage({
  status,
  packId,
  setError,
  onRefresh,
}: {
  status: AppStatus;
  packId: string | null;
  setError: (value: string) => void;
  onRefresh: () => Promise<AppStatus>;
}) {
  const [templates, setTemplates] = useState<PublishTemplate[]>([]);
  const [pack, setPack] = useState<ListingPackManifest | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [sections, setSections] = useState<ShopSection[]>(status.sections);
  const [shopSectionId, setShopSectionId] = useState<number | "">("");
  const [taxonomyQuery, setTaxonomyQuery] = useState("");
  const [taxonomyHits, setTaxonomyHits] = useState<TaxonomyHit[]>(status.recentTaxonomy);
  const [taxonomyId, setTaxonomyId] = useState<number | "">("");
  const [price, setPrice] = useState(19);
  const [quantity, setQuantity] = useState(1);
  const [listingType, setListingType] = useState<ListingType>("physical");
  const [applyVariations, setApplyVariations] = useState(true);
  const [result, setResult] = useState<DraftPublishResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.templates().then((list) => {
      setTemplates(list);
      if (list[0]) {
        setTemplateId(list[0].id);
        setListingType(list[0].listingType);
        setApplyVariations(Boolean(list[0].inventory?.products?.length));
        if (list[0].taxonomyId) setTaxonomyId(list[0].taxonomyId);
        if (list[0].shopSectionId) setShopSectionId(list[0].shopSectionId);
      }
    });
    if (packId) {
      api.pack(packId).then((detail) => {
        setPack(detail.pack);
        setPrice(detail.pack.price);
        setQuantity(detail.pack.quantity);
        setListingType(detail.pack.listingType);
      });
    }
  }, [packId]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId),
    [templates, templateId],
  );

  async function searchTaxonomy() {
    setError("");
    try {
      setTaxonomyHits(await api.searchTaxonomy(taxonomyQuery));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-display text-2xl">Create an Etsy draft</h2>
        <p className="text-sm text-stone-600">
          This never auto-activates a listing. After success, open the draft in Seller Manager and
          publish it yourself.
        </p>
        {!pack && <p className="text-sm text-amber-800">Select a pack from the Pack tab first.</p>}
        <Field label="Template (cloned from your shop)">
          <select
            className={inputClass()}
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const next = templates.find((item) => item.id === e.target.value);
              if (next) {
                setListingType(next.listingType);
                setApplyVariations(Boolean(next.inventory?.products?.length));
                if (next.taxonomyId) setTaxonomyId(next.taxonomyId);
                if (next.shopSectionId) setShopSectionId(next.shopSectionId);
              }
            }}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </Field>
        {selectedTemplate && (
          <p className="text-xs text-stone-500">
            Source listing {selectedTemplate.sourceListingId} · {selectedTemplate.listingType} · who_made{" "}
            {selectedTemplate.whoMade}
            {variationSummary(selectedTemplate.inventory)
              ? ` · ${variationSummary(selectedTemplate.inventory)}`
              : ""}
          </p>
        )}
        {variationSummary(selectedTemplate?.inventory) && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyVariations}
              onChange={(e) => setApplyVariations(e.target.checked)}
            />
            Copy variations from this template ({variationSummary(selectedTemplate?.inventory)})
          </label>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Shop section">
            <select
              className={inputClass()}
              value={shopSectionId}
              onChange={(e) => setShopSectionId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">None</option>
              {sections.map((section) => (
                <option key={section.shopSectionId} value={section.shopSectionId}>
                  {section.title}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="rounded-full border border-stone-400 px-3 py-2 text-sm"
            onClick={async () => {
              setSections(await api.refreshSections());
              await onRefresh();
            }}
          >
            Refresh sections
          </button>
        </div>
        <Field label="Taxonomy search">
          <div className="flex gap-2">
            <input
              className={inputClass()}
              value={taxonomyQuery}
              onChange={(e) => setTaxonomyQuery(e.target.value)}
              placeholder="wall art, digital print…"
            />
            <button className="rounded-full border border-stone-400 px-3 py-2 text-sm" onClick={searchTaxonomy}>
              Search
            </button>
          </div>
        </Field>
        <ul className="max-h-40 overflow-auto text-sm">
          {taxonomyHits.map((hit) => (
            <li key={hit.id}>
              <button
                className={`underline ${taxonomyId === hit.id ? "font-semibold" : ""}`}
                onClick={async () => {
                  setTaxonomyId(hit.id);
                  await api.rememberTaxonomy(hit);
                }}
              >
                {hit.name} ({hit.id})
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Listing type">
            <select
              className={inputClass()}
              value={listingType}
              onChange={(e) => setListingType(e.target.value as ListingType)}
            >
              <option value="physical">Physical</option>
              <option value="download">Digital download</option>
            </select>
          </Field>
          <Field label="Price (USD)">
            <input
              type="number"
              min={0.2}
              step="0.01"
              className={inputClass()}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </Field>
          <Field label="Quantity">
            <input
              type="number"
              min={1}
              className={inputClass()}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </Field>
        </div>
        <button
          disabled={!pack || !templateId || !taxonomyId || busy}
          className="rounded-full bg-clay px-4 py-2 text-sm text-white"
          onClick={async () => {
            if (!pack || !taxonomyId) return;
            setBusy(true);
            setError("");
            try {
              const created = await api.publish({
                packId: pack.id,
                templateId,
                shopSectionId: shopSectionId || undefined,
                taxonomyId: Number(taxonomyId),
                price,
                quantity,
                listingType,
                applyVariations,
              });
              setResult(created);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating draft…" : "Create draft"}
        </button>
      </section>

      {result && (
        <section className="rounded-2xl border border-lime-200 bg-lime-50 p-6">
          <h3 className="font-display text-xl">Draft created</h3>
          <p className="mt-2 text-sm">Listing ID {result.listingId} · state {result.state}</p>
          <p className="mt-1 text-sm text-stone-700">
            Images {result.imagesUploaded}/{result.imageCount}
            {result.fileCount > 0 ? ` · files ${result.filesUploaded}/${result.fileCount}` : ""}
            {result.variationsApplied ? " · variations copied" : ""}
          </p>
          <a className="mt-3 inline-block underline" href={result.sellerManagerUrl} target="_blank" rel="noreferrer">
            Open draft in Seller Manager
          </a>
          {result.warnings.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-amber-900">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function TemplatesPage({
  setError,
  onChange,
}: {
  setError: (value: string) => void;
  onChange: () => Promise<AppStatus>;
}) {
  const [templates, setTemplates] = useState<PublishTemplate[]>([]);
  const [listingId, setListingId] = useState("");
  const [name, setName] = useState("");

  const reload = useCallback(async () => {
    setTemplates(await api.templates());
    await onChange();
  }, [onChange]);

  useEffect(() => {
    reload().catch((err) => setError(err.message));
  }, [reload, setError]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="font-display text-2xl">Publish templates</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Listing ID from your shop">
            <input className={inputClass()} value={listingId} onChange={(e) => setListingId(e.target.value)} />
          </Field>
          <Field label="Name">
            <input className={inputClass()} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <button
          className="rounded-full bg-ink px-4 py-2 text-sm text-paper"
          onClick={async () => {
            setError("");
            try {
              await api.cloneTemplate(Number(listingId), name || undefined);
              setListingId("");
              setName("");
              await reload();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          Clone from listing
        </button>
      </section>
      <ul className="space-y-3">
        {templates.map((template) => (
          <li key={template.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <input
                className={inputClass()}
                defaultValue={template.name}
                onBlur={async (e) => {
                  if (e.target.value !== template.name) {
                    await api.renameTemplate(template.id, e.target.value);
                    await reload();
                  }
                }}
              />
              <button
                className="text-sm text-clay underline"
                onClick={async () => {
                  await api.deleteTemplate(template.id);
                  await reload();
                }}
              >
                Delete
              </button>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Listing {template.sourceListingId} · {template.listingType} · taxonomy{" "}
              {template.taxonomyId ?? "—"}
              {variationSummary(template.inventory) ? ` · ${variationSummary(template.inventory)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryPage({
  status,
  setError,
}: {
  status: AppStatus;
  setError: (value: string) => void;
}) {
  const [entries, setEntries] = useState<PublishLogEntry[]>(status.recentPublishes ?? []);

  useEffect(() => {
    api
      .publishLog()
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [setError]);

  if (entries.length === 0) {
    return (
      <p className="text-stone-600">
        No draft attempts yet. After you create a draft, it will appear here with the listing ID and
        Seller Manager link.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-2xl">Draft history</h2>
      <p className="text-sm text-stone-600">
        Local log only — stored on this computer. Failed image or variation steps still keep the draft
        listing ID when Etsy created one.
      </p>
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{entry.packTitle}</p>
              <p className="text-xs text-stone-500">{new Date(entry.createdAt).toLocaleString()}</p>
            </div>
            <p className="mt-1 text-sm">
              {entry.state === "draft" ? "Draft" : "Failed"} · template {entry.templateName}
              {entry.listingId ? ` · listing ${entry.listingId}` : ""}
            </p>
            <p className="text-xs text-stone-500">
              Images {entry.imagesUploaded}/{entry.imageCount}
              {entry.fileCount > 0 ? ` · files ${entry.filesUploaded}/${entry.fileCount}` : ""}
              {entry.variationsApplied ? " · variations copied" : ""}
            </p>
            {entry.sellerManagerUrl && (
              <a
                className="mt-2 inline-block text-sm underline"
                href={entry.sellerManagerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in Seller Manager
              </a>
            )}
            {entry.error && <p className="mt-2 text-sm text-red-800">{entry.error}</p>}
            {entry.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-900">
                {entry.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
