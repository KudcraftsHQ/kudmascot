// kudmascot server: request -> draft -> approve -> publish.
// Bun + Hono + bun:sqlite. One worker loop, one image generation at a time.
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { reviewPage, loginPage } from "./page";
import { suggestFor, type Candidate, type Platform } from "./match";

const HOME = homedir();
const PORT = Number(process.env.KUDMASCOT_PORT ?? 4488);
const HOST = process.env.KUDMASCOT_HOST ?? "127.0.0.1";
const TOKEN = process.env.KUDMASCOT_TOKEN ?? "";
const ROOT = resolve(import.meta.dir, "../.."); // the source checkout: style/ lives here
const DATA = process.env.KUDMASCOT_DATA ?? join(HOME, ".local/share/kudmascot");
const STATE = process.env.KUDMASCOT_STATE ?? join(HOME, ".local/state/kudmascot");
const PUBLISH_REPO = process.env.KUDMASCOT_PUBLISH_REPO ?? join(DATA, "repo");
const GH_REPO = process.env.KUDMASCOT_GH_REPO ?? "KudcraftsHQ/kudmascot";
const REMOTE = process.env.KUDMASCOT_REMOTE ?? `git@github.com:${GH_REPO}.git`;
const BRIDGE = process.env.KUDMASCOT_BRIDGE ?? join(ROOT, "server/bin/gpt-image-icon");
const GEN_TIMEOUT_MS = Number(process.env.KUDMASCOT_GEN_TIMEOUT_MS ?? 15 * 60_000);
const BATCH_MAX = Number(process.env.KUDMASCOT_BATCH_MAX ?? 9);
// wait this long after the newest Generate tap, so taps made in a row land in one grid
const BATCH_SETTLE_MS = Number(process.env.KUDMASCOT_BATCH_SETTLE_MS ?? 45_000);
const VARIANTS = [
  "Lean the object to the right (clockwise), cropped by the bottom and right edges.",
  "Mirror the usual layout: lean the object to the LEFT (counter-clockwise), with its body running off the bottom and LEFT edges and the open background at the top-right.",
];

if (!TOKEN) {
  console.error("KUDMASCOT_TOKEN is not set (see ~/.config/kudmascot/env)");
  process.exit(1);
}
for (const d of [DATA, STATE, join(DATA, "originals"), join(DATA, "drafts"), join(DATA, "mac"), join(STATE, "jobs")]) mkdirSync(d, { recursive: true });

function log(...a: unknown[]) {
  const line = `${new Date().toISOString()} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`;
  console.log(line);
  appendFileSync(join(STATE, "server.log"), line + "\n");
}

// ---------- db ----------
const db = new Database(join(DATA, "kudmascot.sqlite"));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS apps (
  drawable TEXT PRIMARY KEY,
  package TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,           -- requested (inbox, phone asked) | queued (Hammas pressed Generate) | generating | drafted | approved | published | skipped | failed
  original TEXT,                  -- file name under originals/
  hint TEXT,
  note TEXT,                      -- reviewer note for the pending regeneration
  note_variant INTEGER,           -- variant the note was written about
  round INTEGER NOT NULL DEFAULT 0,
  approved_variant INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS components (
  component TEXT PRIMARY KEY,     -- pkg/activity
  drawable TEXT NOT NULL,
  label TEXT NOT NULL,
  in_catalog INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drawable TEXT NOT NULL,
  round INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  raw TEXT NOT NULL,
  png TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  sha TEXT,
  count INTEGER NOT NULL,
  status TEXT NOT NULL,           -- pushing | pushed | failed
  error TEXT
);
`);
// In-place migrations (additive only; existing rows keep their data and default to android).
function addColumn(table: string, col: string, def: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`migrated: ${table}.${col}`);
  }
}
addColumn("components", "platform", "TEXT NOT NULL DEFAULT 'android'"); // android | mac (component 'mac:<bundleId>')
addColumn("apps", "platform", "TEXT NOT NULL DEFAULT 'android'");       // platform of the request that created the drawing
addColumn("apps", "suggest", "TEXT");                                   // drawable of a cross-platform match (never auto-merged)
addColumn("apps", "suggest_reason", "TEXT");
addColumn("apps", "merged_into", "TEXT");                               // status 'merged': "Use same drawing" pointed it here
const now = () => new Date().toISOString();

export type App = {
  drawable: string; package: string; label: string; status: string; original: string | null;
  hint: string | null; note: string | null; note_variant: number | null; round: number;
  approved_variant: number | null; error: string | null; created_at: string; updated_at: string;
  platform: Platform; suggest: string | null; suggest_reason: string | null; merged_into: string | null;
};
type Component = { component: string; drawable: string; label: string; in_catalog: number; platform: Platform; created_at: string };
export type Variant = { id: number; drawable: string; round: number; idx: number; raw: string; png: string; note: string | null; created_at: string };

export function drawableFor(pkg: string) {
  let d = pkg.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  if (!/^[a-z]/.test(d)) d = "a_" + d;
  return d;
}

// ---------- worker ----------
let busy: string | null = null;

function promptFor(app: App, variantIdx: number) {
  const md = readFileSync(join(ROOT, "style/prompt.md"), "utf8");
  const m = md.match(/<!-- prompt:start -->([\s\S]*?)<!-- prompt:end -->/);
  if (!m) throw new Error("style/prompt.md has no prompt block");
  const note = app.note
    ? `REVIEWER NOTE (most important — the FOURTH reference image is the draft this note is about; fix exactly this): ${app.note}`
    : "";
  return m[1]
    .replaceAll("{{LABEL}}", app.label)
    .replaceAll("{{PACKAGE}}", app.package)
    .replaceAll("{{HINT}}", app.hint ?? "")
    .replaceAll("{{VARIANT}}", VARIANTS[variantIdx % VARIANTS.length])
    .replaceAll("{{NOTE}}", note)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function run(cmd: string[], logFile: string, timeoutMs: number) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  appendFileSync(logFile, `$ ${cmd.map((c) => (c.length > 80 ? c.slice(0, 80) + "…" : c)).join(" ")}\n${out}\n${err}\nexit ${code}\n`);
  return { code, out, err };
}

async function generate(app: App) {
  const round = app.round + 1;
  const jobLog = join(STATE, "jobs", `${app.drawable}-r${round}.log`);
  const refs = ["--ref", join(ROOT, "style/refs/family-clean.png"), "--ref", join(ROOT, "style/refs/ntfy-D2.png")];
  if (app.original) refs.push("--ref", join(DATA, "originals", app.original));
  if (app.note && app.note_variant) {
    const v = db.query("SELECT * FROM variants WHERE id = ?").get(app.note_variant) as Variant | null;
    if (v) refs.push("--ref", join(DATA, "drafts", v.raw));
  }
  let made = 0;
  let lastErr = "";
  for (let i = 0; i < VARIANTS.length; i++) {
    const stem = `${app.drawable}-r${round}-v${i + 1}-${Date.now()}`;
    const raw = join(DATA, "drafts", `${stem}-raw.png`);
    const png = join(DATA, "drafts", `${stem}.png`);
    log("generate", app.drawable, `round ${round} variant ${i + 1}`);
    const g = await run([BRIDGE, promptFor(app, i), raw, "--size", "1024x1024", ...refs], jobLog, GEN_TIMEOUT_MS);
    if (g.code !== 0 || !existsSync(raw)) {
      lastErr = `bridge exit ${g.code}: ${g.err.slice(-300)}`;
      log("generate failed", app.drawable, lastErr);
      continue;
    }
    const m = await run(["python3", join(ROOT, "style/mute.py"), raw, png], jobLog, 60_000);
    if (m.code !== 0) {
      lastErr = `mute exit ${m.code}: ${m.err.slice(-300)}`;
      continue;
    }
    db.query("INSERT INTO variants (drawable, round, idx, raw, png, note, created_at) VALUES (?,?,?,?,?,?,?)").run(
      app.drawable, round, i + 1, basename(raw), basename(png), app.note, now(),
    );
    made++;
  }
  if (made > 0) {
    db.query("UPDATE apps SET status='drafted', round=?, note=NULL, note_variant=NULL, error=?, updated_at=? WHERE drawable=?").run(
      round, made < VARIANTS.length ? lastErr : null, now(), app.drawable,
    );
  } else {
    db.query("UPDATE apps SET status='failed', error=?, updated_at=? WHERE drawable=?").run(lastErr || "no variants", now(), app.drawable);
  }
}

function gridPrompt(apps: App[], cols: number, rows: number) {
  const md = readFileSync(join(ROOT, "style/prompt.md"), "utf8");
  const m = md.match(/<!-- grid:start -->([\s\S]*?)<!-- grid:end -->/);
  if (!m) throw new Error("style/prompt.md has no grid block");
  const cells = apps
    .map((a, i) => {
      const lean = i % 2 ? "leans LEFT (counter-clockwise), body off the bottom-left" : "leans RIGHT (clockwise), body off the bottom-right";
      return `${i + 1}. (row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}) "${a.label}" (${a.package}): object ${lean}.${a.hint ? " " + a.hint : ""}`;
    })
    .join("\n");
  return m[1]
    .replaceAll("{{N}}", String(apps.length))
    .replaceAll("{{COLS}}", String(cols))
    .replaceAll("{{ROWS}}", String(rows))
    .replaceAll("{{CELLS}}", cells)
    .trim();
}

// One image call for up to BATCH_MAX apps: a contact sheet, cut into one draft each.
async function generateBatch(apps: App[]) {
  const n = apps.length;
  const cols = n <= 3 ? n : 3;
  const rows = Math.ceil(n / cols);
  const stem = `batch-${Date.now()}`;
  const jobLog = join(STATE, "jobs", `${stem}.log`);
  const sheet = join(DATA, "drafts", `${stem}-sheet.png`);
  const refSheet = join(DATA, "drafts", `${stem}-refs.png`);
  const fail = (err: string) => {
    log("batch failed", stem, err);
    for (const a of apps) db.query("UPDATE apps SET status='failed', error=?, updated_at=? WHERE drawable=?").run(err, now(), a.drawable);
  };
  const origs = apps.map((a) => (a.original ? join(DATA, "originals", a.original) : ""));
  const r = await run(["python3", join(ROOT, "style/grid.py"), "refsheet", refSheet, String(cols), ...origs], jobLog, 60_000);
  if (r.code !== 0) return fail(`refsheet exit ${r.code}: ${r.err.slice(-300)}`);
  const refs = ["--ref", join(ROOT, "style/refs/family-clean.png"), "--ref", join(ROOT, "style/refs/ntfy-D2.png"), "--ref", refSheet];
  log("generate batch", stem, apps.map((a) => a.drawable).join(","));
  const g = await run([BRIDGE, gridPrompt(apps, cols, rows), sheet, "--size", `${cols * 512}x${rows * 512}`, ...refs], jobLog, GEN_TIMEOUT_MS);
  if (g.code !== 0 || !existsSync(sheet)) return fail(`bridge exit ${g.code}: ${g.err.slice(-300)}`);
  const sp = await run(["python3", join(ROOT, "style/grid.py"), "split", sheet, String(cols), String(rows), String(n), join(DATA, "drafts"), stem], jobLog, 60_000);
  if (sp.code !== 0) return fail(`split exit ${sp.code}: ${sp.err.slice(-300)}`);
  for (let i = 0; i < n; i++) {
    const a = apps[i];
    const round = a.round + 1;
    const raw = join(DATA, "drafts", `${stem}-${i + 1}.png`);
    const png = join(DATA, "drafts", `${a.drawable}-r${round}-v1-${stem}.png`);
    const m = await run(["python3", join(ROOT, "style/mute.py"), raw, png], jobLog, 60_000);
    if (m.code !== 0 || !existsSync(png)) {
      db.query("UPDATE apps SET status='failed', error=?, updated_at=? WHERE drawable=?").run(`mute exit ${m.code}: ${m.err.slice(-300)}`, now(), a.drawable);
      continue;
    }
    db.query("INSERT INTO variants (drawable, round, idx, raw, png, note, created_at) VALUES (?,?,?,?,?,?,?)").run(
      a.drawable, round, 1, basename(raw), basename(png), null, now(),
    );
    db.query("UPDATE apps SET status='drafted', round=?, error=NULL, updated_at=? WHERE drawable=?").run(round, now(), a.drawable);
  }
}

async function workerLoop() {
  // anything left "generating" by a crash goes back in the queue
  db.query("UPDATE apps SET status='queued' WHERE status='generating'").run();
  for (;;) {
    // a reviewer note means a single-icon redo (2 variants); everything else is drawn in grids
    const noted = db.query("SELECT * FROM apps WHERE status='queued' AND note IS NOT NULL ORDER BY updated_at LIMIT 1").get() as App | null;
    if (!noted) {
      const batch = db.query("SELECT * FROM apps WHERE status='queued' ORDER BY updated_at LIMIT ?").all(BATCH_MAX) as App[];
      const newest = Math.max(0, ...batch.map((a) => Date.parse(a.updated_at) || 0));
      if (!batch.length || (batch.length < BATCH_MAX && Date.now() - newest < BATCH_SETTLE_MS)) {
        await Bun.sleep(3000);
        continue;
      }
      busy = `${batch.length} apps`;
      for (const a of batch) db.query("UPDATE apps SET status='generating', updated_at=? WHERE drawable=?").run(now(), a.drawable);
      try {
        await generateBatch(batch);
      } catch (e) {
        log("worker error", "batch", String(e));
        for (const a of batch)
          db.query("UPDATE apps SET status='failed', error=?, updated_at=? WHERE drawable=? AND status='generating'").run(String(e), now(), a.drawable);
      }
      busy = null;
      continue;
    }
    const app = noted;
    busy = app.drawable;
    db.query("UPDATE apps SET status='generating', updated_at=? WHERE drawable=?").run(now(), app.drawable);
    try {
      await generate(app);
    } catch (e) {
      log("worker error", app.drawable, String(e));
      db.query("UPDATE apps SET status='failed', error=?, updated_at=? WHERE drawable=?").run(String(e), now(), app.drawable);
    }
    busy = null;
  }
}

// ---------- publish ----------
let publishing = false;

async function git(args: string[], cwd = PUBLISH_REPO) {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err || out}`);
  return out.trim();
}

function pendingPublish() {
  // Only drawings an Android launcher component points at go into the APK. Mac-only drawings stay
  // 'approved' (the Mac app serves them from /api/mac/icons without a publish).
  const apps = db
    .query("SELECT * FROM apps a WHERE status='approved' AND EXISTS (SELECT 1 FROM components c WHERE c.drawable=a.drawable AND c.platform='android')")
    .all() as App[];
  const comps = db
    .query("SELECT c.* FROM components c JOIN apps a ON a.drawable=c.drawable WHERE c.in_catalog=0 AND c.platform='android' AND a.status IN ('approved','published')")
    .all() as { component: string; drawable: string; label: string }[];
  return { apps, comps };
}

type Catalog = { icons: { drawable: string; label: string; components: string[]; added: string }[] };

async function publish() {
  const { apps, comps } = pendingPublish();
  if (!apps.length && !comps.length) throw new Error("nothing to publish");
  publishing = true;
  const pub = db.query("INSERT INTO publishes (created_at, count, status) VALUES (?,?, 'pushing') RETURNING id").get(now(), apps.length) as { id: number };
  try {
    if (!existsSync(join(PUBLISH_REPO, ".git"))) {
      mkdirSync(PUBLISH_REPO, { recursive: true });
      await git(["clone", REMOTE, PUBLISH_REPO], DATA);
    }
    await git(["fetch", "origin", "main"]);
    await git(["checkout", "-B", "main", "origin/main"]);
    await git(["reset", "--hard", "origin/main"]);
    mkdirSync(join(PUBLISH_REPO, "icons"), { recursive: true });
    const catPath = join(PUBLISH_REPO, "icons/catalog.json");
    const cat: Catalog = existsSync(catPath) ? JSON.parse(readFileSync(catPath, "utf8")) : { icons: [] };
    const byDrawable = new Map(cat.icons.map((i) => [i.drawable, i]));
    const ensure = (drawable: string, label: string) => {
      let e = byDrawable.get(drawable);
      if (!e) {
        e = { drawable, label, components: [], added: now().slice(0, 10) };
        cat.icons.push(e);
        byDrawable.set(drawable, e);
      }
      return e;
    };
    for (const a of apps) {
      const v = db.query("SELECT * FROM variants WHERE id=?").get(a.approved_variant) as Variant;
      copyFileSync(join(DATA, "drafts", v.png), join(PUBLISH_REPO, "icons", `${a.drawable}.png`));
      ensure(a.drawable, a.label);
    }
    const allComps = db
      .query("SELECT c.* FROM components c JOIN apps a ON a.drawable=c.drawable WHERE c.platform='android' AND a.status IN ('approved','published')")
      .all() as { component: string; drawable: string; label: string }[];
    for (const c of allComps) {
      const e = byDrawable.get(c.drawable);
      if (e && !e.components.includes(c.component)) e.components.push(c.component);
    }
    for (const e of cat.icons) e.components.sort();
    cat.icons.sort((x, y) => x.drawable.localeCompare(y.drawable));
    writeFileSync(catPath, JSON.stringify(cat, null, 2) + "\n");
    await git(["add", "icons"]);
    const names = apps.map((a) => a.label).join(", ") || `${comps.length} component(s)`;
    await git([
      "-c", "user.name=kudmascot-server", "-c", "user.email=kudmascot@kudcrafts.com",
      "commit", "-m", `icons: publish ${apps.length} (${names})`.slice(0, 200),
    ]);
    await git(["push", "origin", "HEAD:main"]);
    const sha = await git(["rev-parse", "HEAD"]);
    db.transaction(() => {
      for (const a of apps) db.query("UPDATE apps SET status='published', updated_at=? WHERE drawable=?").run(now(), a.drawable);
      for (const c of allComps) db.query("UPDATE components SET in_catalog=1 WHERE component=?").run(c.component);
      db.query("UPDATE publishes SET status='pushed', sha=? WHERE id=?").run(sha, pub.id);
    })();
    log("published", sha, names);
    ciCache.at = 0;
    return { sha, count: apps.length };
  } catch (e) {
    db.query("UPDATE publishes SET status='failed', error=? WHERE id=?").run(String(e), pub.id);
    log("publish failed", String(e));
    throw e;
  } finally {
    publishing = false;
  }
}

let ciCache: { at: number; data: unknown } = { at: 0, data: null };
let ciRefreshing = false;
// Never blocks a request: returns the cached value and refreshes in the background (gh takes ~2-3 s).
function ciStatus() {
  if (Date.now() - ciCache.at > 20_000 && !ciRefreshing) {
    ciRefreshing = true;
    refreshCi().finally(() => (ciRefreshing = false));
  }
  return ciCache.data;
}
async function refreshCi() {
  try {
    const p = Bun.spawn(
      ["gh", "run", "list", "--repo", GH_REPO, "--branch", "main", "--limit", "5", "--json", "databaseId,headSha,status,conclusion,url,createdAt,displayTitle"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const out = await new Response(p.stdout).text();
    await p.exited;
    const runs = JSON.parse(out || "[]");
    const r = Bun.spawn(["gh", "release", "view", "--repo", GH_REPO, "--json", "tagName,url,publishedAt"], { stdout: "pipe", stderr: "pipe" });
    const rel = await new Response(r.stdout).text();
    await r.exited;
    ciCache = { at: Date.now(), data: { runs, release: rel ? JSON.parse(rel) : null } };
  } catch (e) {
    ciCache = { at: Date.now(), data: { error: String(e) } };
  }
}

// ---------- http ----------
const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, busy }));

app.get("/login", (c) => c.html(loginPage()));
app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  if (body.token !== TOKEN) return c.html(loginPage("Wrong token"), 401);
  setCookie(c, "km_token", TOKEN, { httpOnly: true, sameSite: "Lax", maxAge: 60 * 60 * 24 * 365, path: "/", secure: c.req.url.startsWith("https") || c.req.header("x-forwarded-proto") === "https" });
  return c.redirect("/");
});

app.use("*", async (c, next) => {
  const auth = c.req.header("authorization");
  const ok = auth === `Bearer ${TOKEN}` || getCookie(c, "km_token") === TOKEN;
  if (ok) return next();
  if (c.req.method === "GET" && !c.req.path.startsWith("/api/")) return c.redirect("/login");
  return c.json({ error: "unauthorized" }, 401);
});

// ---- phone + Mac API ----
function saveOriginal(drawable: string, icon?: string) {
  if (!icon) return null;
  const original = `${drawable}.png`;
  const buf = Buffer.from(icon.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const tmp = join(DATA, "originals", `${drawable}.upload.png`);
  writeFileSync(tmp, buf);
  // flatten transparency onto white so the model sees the real silhouette
  const f = Bun.spawnSync(["python3", "-c",
    "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');bg=Image.new('RGBA',im.size,(255,255,255,255));bg.alpha_composite(im);bg.convert('RGB').save(sys.argv[2])",
    tmp, join(DATA, "originals", original)]);
  return f.exitCode === 0 ? original : null;
}

// Existing drawings that could be the same app on the other platform.
function candidates(exclude: string): Candidate[] {
  const apps = db.query("SELECT drawable, label FROM apps WHERE status NOT IN ('merged','skipped') AND drawable != ?").all(exclude) as { drawable: string; label: string }[];
  const comps = db.query("SELECT component, drawable, platform FROM components").all() as Component[];
  const by = new Map<string, Candidate>(apps.map((a) => [a.drawable, { drawable: a.drawable, label: a.label, ids: [] }]));
  for (const c of comps) {
    const k = by.get(c.drawable);
    if (!k) continue;
    k.ids.push({ platform: c.platform, id: c.platform === "mac" ? c.component.slice(4) : c.component.split("/")[0] });
  }
  return [...by.values()];
}

function suggestInto(drawable: string, platform: Platform, id: string, label: string) {
  const s = suggestFor(platform, id, label, candidates(drawable));
  if (!s) return;
  db.query("UPDATE apps SET suggest=?, suggest_reason=? WHERE drawable=?").run(s.drawable, s.reason, drawable);
  log("suggest", drawable, "->", s.drawable, s.reason);
}

// Follow "Use same drawing" links so later requests land on the shared drawing.
function resolveApp(drawable: string) {
  let a = db.query("SELECT * FROM apps WHERE drawable=?").get(drawable) as App | null;
  for (let i = 0; a && a.status === "merged" && a.merged_into && i < 5; i++)
    a = db.query("SELECT * FROM apps WHERE drawable=?").get(a.merged_into) as App | null;
  return a;
}

type ReqIn = { package?: string; activity?: string; label?: string; icon?: string; hint?: string; platform?: string; bundleId?: string; name?: string };

// POST /api/requests
//   Android (unchanged): { requests: [{ package, activity, label, icon (base64 PNG) }] }
//   Mac: { platform: "mac", requests: [{ bundleId, name, icon }] }  (or platform:"mac" per request)
app.post("/api/requests", async (c) => {
  const body = await c.req.json<{ platform?: string; requests: ReqIn[] }>();
  const results: { component: string; drawable: string; status: string; created: boolean; suggest?: string | null }[] = [];
  for (const r of body.requests ?? []) {
    const platform: Platform = (r.platform ?? body.platform) === "mac" ? "mac" : "android";
    if (platform === "mac") {
      const bundleId = (r.bundleId ?? r.package ?? "").trim();
      if (!bundleId) continue;
      const component = `mac:${bundleId}`;
      const label = (r.name || r.label || bundleId).slice(0, 80);
      const existing = db.query("SELECT * FROM components WHERE component=?").get(component) as Component | null;
      let a = existing ? resolveApp(existing.drawable) : null;
      let created = false;
      if (!a) {
        const drawable = "mac_" + drawableFor(bundleId);
        a = resolveApp(drawable);
        if (!a) {
          db.query("INSERT INTO apps (drawable, package, label, status, original, hint, platform, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
            drawable, bundleId, label, "requested", saveOriginal(drawable, r.icon), r.hint ?? null, "mac", now(), now(),
          );
          suggestInto(drawable, "mac", bundleId, label);
          a = db.query("SELECT * FROM apps WHERE drawable=?").get(drawable) as App;
          created = true;
          log("request", component, label);
        }
      }
      if (a.status === "failed") {
        db.query("UPDATE apps SET status='requested', updated_at=? WHERE drawable=?").run(now(), a.drawable);
        a.status = "requested";
      }
      if (!existing)
        db.query("INSERT OR IGNORE INTO components (component, drawable, label, platform, created_at) VALUES (?,?,?,?,?)").run(component, a.drawable, label, "mac", now());
      results.push({ component, drawable: a.drawable, status: a.status, created, suggest: a.suggest });
      continue;
    }
    if (!r.package || !r.activity) continue;
    const activity = r.activity.startsWith(".") ? r.package + r.activity : r.activity;
    const component = `${r.package}/${activity}`;
    const existing = db.query("SELECT * FROM components WHERE component=?").get(component) as Component | null;
    const label = (r.label || r.package).slice(0, 80);
    let a = resolveApp(existing ? existing.drawable : drawableFor(r.package));
    let created = false;
    if (!a) {
      const drawable = drawableFor(r.package);
      db.query("INSERT INTO apps (drawable, package, label, status, original, hint, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
        drawable, r.package, label, "requested", saveOriginal(drawable, r.icon), r.hint ?? null, now(), now(),
      );
      suggestInto(drawable, "android", r.package, label);
      a = db.query("SELECT * FROM apps WHERE drawable=?").get(drawable) as App;
      created = true;
      log("request", component, label);
    } else if (a.status === "failed") {
      db.query("UPDATE apps SET status='requested', updated_at=? WHERE drawable=?").run(now(), a.drawable);
      a.status = "requested";
    }
    db.query("INSERT OR IGNORE INTO components (component, drawable, label, created_at) VALUES (?,?,?,?)").run(component, a.drawable, label, now());
    results.push({ component, drawable: a.drawable, status: a.status, created });
  }
  return c.json({ results });
});

// GET /api/status -> { components: { "pkg/act": status }, packages: { pkg: status } }   (Android only, as before)
app.get("/api/status", (c) => {
  const rows = db
    .query("SELECT c.component, a.package, a.status, a.merged_into FROM components c JOIN apps a ON a.drawable=c.drawable WHERE c.platform='android'")
    .all() as { component: string; package: string; status: string; merged_into: string | null }[];
  const st = (r: { status: string; merged_into: string | null }) => (r.status === "merged" && r.merged_into ? resolveApp(r.merged_into)?.status ?? r.status : r.status);
  const apps = db.query("SELECT package, status, merged_into FROM apps WHERE platform='android'").all() as { package: string; status: string; merged_into: string | null }[];
  const packages: Record<string, string> = Object.fromEntries(apps.map((r) => [r.package, st(r)]));
  return c.json({
    components: Object.fromEntries(rows.map((r) => [r.component, st(r)])),
    packages,
  });
});

// ---- Mac art ----
const MACOS_PY = join(ROOT, "style/macos.py");
function variantById(id: number | null) {
  return id ? (db.query("SELECT * FROM variants WHERE id=?").get(id) as Variant | null) : null;
}
// Version = hash of the art and of the shape step, so either changing makes the Mac re-apply.
function macVersion(v: Variant) {
  const h = createHash("sha256");
  h.update(readFileSync(join(DATA, "drafts", v.png)));
  h.update(readFileSync(MACOS_PY));
  return h.digest("hex").slice(0, 16);
}
// Mac-shaped 1024 px PNG for a variant, rendered once by style/macos.py and cached under mac/.
function macPng(v: Variant) {
  const ver = macVersion(v);
  const out = join(DATA, "mac", `${v.drawable}-${v.id}-${ver}.png`);
  if (existsSync(out)) return { path: out, version: ver };
  const raw = join(DATA, "drafts", v.raw);
  // the raw generation is un-muted and larger; mute it here for a sharper 824 px body
  const args = existsSync(raw) ? [raw, out, "--mute"] : [join(DATA, "drafts", v.png), out];
  const r = Bun.spawnSync(["python3", MACOS_PY, ...args], { stderr: "pipe" });
  if (r.exitCode !== 0 || !existsSync(out)) throw new Error(`macos.py exit ${r.exitCode}: ${r.stderr.toString().slice(-300)}`);
  return { path: out, version: ver };
}

// GET /api/mac/icons -> every Mac component whose drawing is approved or published
app.get("/api/mac/icons", (c) => {
  const rows = db
    .query("SELECT c.component, a.drawable, a.approved_variant FROM components c JOIN apps a ON a.drawable=c.drawable WHERE c.platform='mac' AND a.status IN ('approved','published') AND a.approved_variant IS NOT NULL")
    .all() as { component: string; drawable: string; approved_variant: number }[];
  const icons = [];
  for (const r of rows) {
    const v = variantById(r.approved_variant);
    if (!v) continue;
    icons.push({ bundleId: r.component.slice(4), drawable: r.drawable, version: macVersion(v), url: `/api/mac/icon/${r.drawable}.png` });
  }
  return c.json({ icons });
});

// GET /api/mac/icon/:drawable.png — stable URL; always the current approved art, Mac-shaped
app.get("/api/mac/icon/:file", (c) => {
  const d = basename(c.req.param("file")).replace(/\.png$/, "");
  const a = db.query("SELECT * FROM apps WHERE drawable=? AND status IN ('approved','published')").get(d) as App | null;
  const v = variantById(a?.approved_variant ?? null);
  if (!v) return c.notFound();
  const m = macPng(v);
  return new Response(Bun.file(m.path), { headers: { "content-type": "image/png", etag: `"${m.version}"`, "x-kudmascot-version": m.version, "cache-control": "private, no-cache" } });
});

// GET /api/mac/status -> { apps: { bundleId: { status, suggest } } } for the menu-bar counts
app.get("/api/mac/status", (c) => {
  const rows = db
    .query("SELECT c.component, a.drawable, a.status, a.merged_into, a.suggest FROM components c JOIN apps a ON a.drawable=c.drawable WHERE c.platform='mac'")
    .all() as { component: string; drawable: string; status: string; merged_into: string | null; suggest: string | null }[];
  const apps: Record<string, { status: string; suggested: boolean }> = {};
  for (const r of rows) {
    const a = r.status === "merged" && r.merged_into ? resolveApp(r.merged_into) : null;
    apps[r.component.slice(4)] = { status: a?.status ?? r.status, suggested: !!r.suggest && r.status === "requested" };
  }
  return c.json({ apps });
});

// ---- review API ----
app.get("/api/review", async (c) => {
  const apps = db.query("SELECT * FROM apps ORDER BY updated_at DESC").all() as App[];
  const variants = db.query("SELECT * FROM variants ORDER BY round DESC, idx").all() as Variant[];
  const comps = db.query("SELECT * FROM components").all() as Component[];
  const { apps: pa, comps: pc } = pendingPublish();
  const pubs = db.query("SELECT * FROM publishes ORDER BY id DESC LIMIT 5").all();
  const byD = new Map(apps.map((a) => [a.drawable, a]));
  return c.json({
    busy, publishing,
    apps: apps.filter((a) => a.status !== "merged").map((a) => {
      const mine = comps.filter((x) => x.drawable === a.drawable);
      const t = a.suggest && a.status === "requested" ? byD.get(a.suggest) : undefined;
      const tv = t ? variants.find((v) => v.id === t.approved_variant) ?? variants.find((v) => v.drawable === t.drawable && v.round === t.round) : undefined;
      return {
        ...a,
        variants: variants.filter((v) => v.drawable === a.drawable),
        components: mine.map((x) => x.component),
        platforms: [...new Set(mine.map((x) => x.platform))],
        suggestion: t && t.status !== "merged" && t.status !== "skipped"
          ? { drawable: t.drawable, label: t.label, status: t.status, reason: a.suggest_reason, original: t.original, png: tv?.png ?? null,
              platforms: [...new Set(comps.filter((x) => x.drawable === t.drawable).map((x) => x.platform))] }
          : null,
      };
    }),
    pending: { apps: pa.length, components: pc.length },
    publishes: pubs,
    ci: ciStatus(),
  });
});

app.post("/api/apps/:drawable/approve", async (c) => {
  const { variant } = await c.req.json<{ variant: number }>();
  const v = db.query("SELECT * FROM variants WHERE id=? AND drawable=?").get(variant, c.req.param("drawable")) as Variant | null;
  if (!v) return c.json({ error: "no such variant" }, 404);
  db.query("UPDATE apps SET status='approved', approved_variant=?, updated_at=? WHERE drawable=?").run(v.id, now(), v.drawable);
  log("approve", v.drawable, v.id);
  return c.json({ ok: true });
});

app.post("/api/apps/:drawable/regenerate", async (c) => {
  const { note, variant, hint } = await c.req.json<{ note?: string; variant?: number; hint?: string }>();
  const d = c.req.param("drawable");
  const r = db
    .query("UPDATE apps SET status='queued', note=?, note_variant=?, hint=COALESCE(?, hint), error=NULL, updated_at=? WHERE drawable=? AND status!='generating'")
    .run(note?.trim() || null, variant ?? null, hint?.trim() || null, now(), d);
  if (!r.changes) return c.json({ error: "not found or generating" }, 409);
  log("regenerate", d, note ?? "");
  return c.json({ ok: true });
});

// Phone requests only land in the inbox ('requested'); nothing generates until Hammas queues it here.
app.post("/api/apps/:drawable/queue", async (c) => {
  const { hint } = await c.req.json<{ hint?: string }>().catch(() => ({}) as { hint?: string });
  const d = c.req.param("drawable");
  const r = db
    .query("UPDATE apps SET status='queued', hint=COALESCE(?, hint), error=NULL, updated_at=? WHERE drawable=? AND status IN ('requested','failed','skipped')")
    .run(hint?.trim() || null, now(), d);
  if (!r.changes) return c.json({ error: "not in the inbox" }, 409);
  log("queue", d);
  return c.json({ ok: true });
});

app.post("/api/apps/:drawable/unqueue", (c) => {
  const d = c.req.param("drawable");
  const has = db.query("SELECT COUNT(*) n FROM variants WHERE drawable=?").get(d) as { n: number };
  const r = db.query("UPDATE apps SET status=?, note=NULL, note_variant=NULL, updated_at=? WHERE drawable=? AND status='queued'").run(
    has.n ? "drafted" : "requested", now(), d,
  );
  if (!r.changes) return c.json({ error: "not queued" }, 409);
  return c.json({ ok: true });
});

app.post("/api/apps/:drawable/skip", (c) => {
  db.query("UPDATE apps SET status='skipped', updated_at=? WHERE drawable=? AND status!='generating'").run(now(), c.req.param("drawable"));
  return c.json({ ok: true });
});

app.post("/api/apps/:drawable/restore", (c) => {
  // skipped -> back to review (drafted if it has variants, else queued); approved -> back to drafted
  const d = c.req.param("drawable");
  const has = db.query("SELECT COUNT(*) n FROM variants WHERE drawable=?").get(d) as { n: number };
  db.query("UPDATE apps SET status=?, approved_variant=NULL, updated_at=? WHERE drawable=? AND status IN ('skipped','approved','failed')").run(
    has.n ? "drafted" : "requested", now(), d,
  );
  return c.json({ ok: true });
});

// "Use same drawing": attach this request's components to an existing drawing (no generation).
// If that drawing is already approved/published, the Mac app picks it up on its next poll.
app.post("/api/apps/:drawable/merge", async (c) => {
  const d = c.req.param("drawable");
  const { target } = await c.req.json<{ target?: string }>().catch(() => ({}) as { target?: string });
  const a = db.query("SELECT * FROM apps WHERE drawable=?").get(d) as App | null;
  if (!a || a.status !== "requested") return c.json({ error: "only an inbox row can be merged" }, 409);
  const t = resolveApp(target || a.suggest || "");
  if (!t || t.drawable === d || t.status === "skipped") return c.json({ error: "no such drawing" }, 404);
  db.transaction(() => {
    db.query("UPDATE components SET drawable=?, in_catalog=0 WHERE drawable=?").run(t.drawable, d);
    db.query("UPDATE apps SET merged_into=? WHERE merged_into=?").run(t.drawable, d);
    db.query("UPDATE apps SET status='merged', merged_into=?, updated_at=? WHERE drawable=?").run(t.drawable, now(), d);
  })();
  log("merge", d, "->", t.drawable, t.status);
  return c.json({ ok: true, drawable: t.drawable, status: t.status });
});

// "Draw separately": drop the suggestion and queue it like Generate.
app.post("/api/apps/:drawable/separate", async (c) => {
  const d = c.req.param("drawable");
  const r = db
    .query("UPDATE apps SET suggest=NULL, suggest_reason=NULL, status='queued', error=NULL, updated_at=? WHERE drawable=? AND status='requested'")
    .run(now(), d);
  if (!r.changes) return c.json({ error: "not in the inbox" }, 409);
  log("separate", d);
  return c.json({ ok: true });
});

app.post("/api/publish", async (c) => {
  if (publishing) return c.json({ error: "already publishing" }, 409);
  try {
    return c.json(await publish());
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get("/img/:kind/:file", (c) => {
  const kind = c.req.param("kind");
  const file = basename(c.req.param("file"));
  if (!["drafts", "originals"].includes(kind)) return c.notFound();
  const p = join(DATA, kind, file);
  if (!existsSync(p)) return c.notFound();
  return new Response(Bun.file(p), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" } });
});

// Mac-shaped preview of one variant (review page)
app.get("/img/macv/:id", (c) => {
  const v = variantById(Number(basename(c.req.param("id")).replace(/\.png$/, "")));
  if (!v) return c.notFound();
  try {
    return new Response(Bun.file(macPng(v).path), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" } });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

app.get("/", (c) => c.html(reviewPage()));

workerLoop();
refreshCi();
log(`kudmascot listening on http://${HOST}:${PORT}`);
export default { port: PORT, hostname: HOST, fetch: app.fetch, idleTimeout: 120 };
