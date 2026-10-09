// kudmascot server: request -> draft -> approve -> publish.
// Bun + Hono + bun:sqlite. One worker loop, one image generation at a time.
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { reviewPage, loginPage } from "./page";

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
const VARIANTS = [
  "Lean the object to the right (clockwise), cropped by the bottom and right edges.",
  "Mirror the usual layout: lean the object to the LEFT (counter-clockwise), with its body running off the bottom and LEFT edges and the open background at the top-right.",
];

if (!TOKEN) {
  console.error("KUDMASCOT_TOKEN is not set (see ~/.config/kudmascot/env)");
  process.exit(1);
}
for (const d of [DATA, STATE, join(DATA, "originals"), join(DATA, "drafts"), join(STATE, "jobs")]) mkdirSync(d, { recursive: true });

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
  status TEXT NOT NULL,           -- requested | generating | drafted | approved | published | skipped | failed
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
const now = () => new Date().toISOString();

export type App = {
  drawable: string; package: string; label: string; status: string; original: string | null;
  hint: string | null; note: string | null; note_variant: number | null; round: number;
  approved_variant: number | null; error: string | null; created_at: string; updated_at: string;
};
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

async function workerLoop() {
  // anything left "generating" by a crash goes back in the queue
  db.query("UPDATE apps SET status='requested' WHERE status='generating'").run();
  for (;;) {
    const app = db.query("SELECT * FROM apps WHERE status='requested' ORDER BY updated_at LIMIT 1").get() as App | null;
    if (!app) {
      await Bun.sleep(3000);
      continue;
    }
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
  const apps = db.query("SELECT * FROM apps WHERE status='approved'").all() as App[];
  const comps = db
    .query("SELECT c.* FROM components c JOIN apps a ON a.drawable=c.drawable WHERE c.in_catalog=0 AND a.status IN ('approved','published')")
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
      .query("SELECT c.* FROM components c JOIN apps a ON a.drawable=c.drawable WHERE a.status IN ('approved','published')")
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
async function ciStatus() {
  if (Date.now() - ciCache.at < 20_000) return ciCache.data;
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
  return ciCache.data;
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

// ---- phone API ----
// POST /api/requests { requests: [{ package, activity, label, icon (base64 PNG) }] }
app.post("/api/requests", async (c) => {
  const body = await c.req.json<{ requests: { package: string; activity: string; label: string; icon?: string; hint?: string }[] }>();
  const results: { component: string; drawable: string; status: string; created: boolean }[] = [];
  for (const r of body.requests ?? []) {
    if (!r.package || !r.activity) continue;
    const activity = r.activity.startsWith(".") ? r.package + r.activity : r.activity;
    const component = `${r.package}/${activity}`;
    const drawable = drawableFor(r.package);
    const label = (r.label || r.package).slice(0, 80);
    let a = db.query("SELECT * FROM apps WHERE drawable=?").get(drawable) as App | null;
    let created = false;
    if (!a) {
      let original: string | null = null;
      if (r.icon) {
        original = `${drawable}.png`;
        const buf = Buffer.from(r.icon.replace(/^data:image\/\w+;base64,/, ""), "base64");
        const tmp = join(DATA, "originals", `${drawable}.upload.png`);
        writeFileSync(tmp, buf);
        // flatten transparency onto white so the model sees the real silhouette
        const f = Bun.spawnSync(["python3", "-c",
          "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');bg=Image.new('RGBA',im.size,(255,255,255,255));bg.alpha_composite(im);bg.convert('RGB').save(sys.argv[2])",
          tmp, join(DATA, "originals", original)]);
        if (f.exitCode !== 0) original = null;
      }
      db.query("INSERT INTO apps (drawable, package, label, status, original, hint, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
        drawable, r.package, label, "requested", original, r.hint ?? null, now(), now(),
      );
      a = db.query("SELECT * FROM apps WHERE drawable=?").get(drawable) as App;
      created = true;
      log("request", component, label);
    } else if (a.status === "failed") {
      db.query("UPDATE apps SET status='requested', updated_at=? WHERE drawable=?").run(now(), drawable);
      a.status = "requested";
    }
    db.query("INSERT OR IGNORE INTO components (component, drawable, label, created_at) VALUES (?,?,?,?)").run(component, drawable, label, now());
    results.push({ component, drawable, status: a.status, created });
  }
  return c.json({ results });
});

// GET /api/status -> { components: { "pkg/act": status }, packages: { pkg: status } }
app.get("/api/status", (c) => {
  const rows = db.query("SELECT c.component, a.package, a.status FROM components c JOIN apps a ON a.drawable=c.drawable").all() as {
    component: string; package: string; status: string;
  }[];
  const apps = db.query("SELECT package, status FROM apps").all() as { package: string; status: string }[];
  return c.json({
    components: Object.fromEntries(rows.map((r) => [r.component, r.status])),
    packages: Object.fromEntries(apps.map((r) => [r.package, r.status])),
  });
});

// ---- review API ----
app.get("/api/review", async (c) => {
  const apps = db.query("SELECT * FROM apps ORDER BY updated_at DESC").all() as App[];
  const variants = db.query("SELECT * FROM variants ORDER BY round DESC, idx").all() as Variant[];
  const comps = db.query("SELECT * FROM components").all() as { component: string; drawable: string; in_catalog: number }[];
  const { apps: pa, comps: pc } = pendingPublish();
  const pubs = db.query("SELECT * FROM publishes ORDER BY id DESC LIMIT 5").all();
  return c.json({
    busy, publishing,
    apps: apps.map((a) => ({
      ...a,
      variants: variants.filter((v) => v.drawable === a.drawable),
      components: comps.filter((x) => x.drawable === a.drawable).map((x) => x.component),
    })),
    pending: { apps: pa.length, components: pc.length },
    publishes: pubs,
    ci: await ciStatus(),
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
    .query("UPDATE apps SET status='requested', note=?, note_variant=?, hint=COALESCE(?, hint), error=NULL, updated_at=? WHERE drawable=? AND status!='generating'")
    .run(note?.trim() || null, variant ?? null, hint?.trim() || null, now(), d);
  if (!r.changes) return c.json({ error: "not found or generating" }, 409);
  log("regenerate", d, note ?? "");
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

app.get("/", (c) => c.html(reviewPage()));

workerLoop();
log(`kudmascot listening on http://${HOST}:${PORT}`);
export default { port: PORT, hostname: HOST, fetch: app.fetch, idleTimeout: 120 };
