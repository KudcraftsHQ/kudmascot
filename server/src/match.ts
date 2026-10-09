// Cross-platform match suggestions: a Mac app and an Android app that are "the same app" should
// usually share one drawing. Never applied automatically; the review page offers it as a suggestion.

// Known pairs where names or ids differ. Each group lists Mac bundle ids and Android packages.
export const KNOWN_PAIRS: { name: string; mac: string[]; android: string[] }[] = [
  { name: "WhatsApp", mac: ["net.whatsapp.WhatsApp", "desktop.WhatsApp"], android: ["com.whatsapp", "com.whatsapp.w4b"] },
  { name: "Chrome", mac: ["com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary"], android: ["com.android.chrome", "com.chrome.beta"] },
  { name: "Telegram", mac: ["ru.keepcoder.Telegram", "org.telegram.desktop", "com.tdesktop.Telegram"], android: ["org.telegram.messenger", "org.telegram.messenger.web"] },
  { name: "Spotify", mac: ["com.spotify.client"], android: ["com.spotify.music"] },
  { name: "Slack", mac: ["com.tinyspeck.slackmacgap"], android: ["com.Slack"] },
  { name: "Discord", mac: ["com.hnc.Discord"], android: ["com.discord"] },
  { name: "Notion", mac: ["notion.id"], android: ["notion.id"] },
  { name: "Zoom", mac: ["us.zoom.xos"], android: ["us.zoom.videomeetings"] },
  { name: "VS Code", mac: ["com.microsoft.VSCode", "com.microsoft.VSCodeInsiders"], android: [] },
  { name: "Figma", mac: ["com.figma.Desktop"], android: ["com.figma.mirror"] },
  { name: "1Password", mac: ["com.1password.1password", "com.agilebits.onepassword7"], android: ["com.onepassword.android", "com.agilebits.onepassword"] },
  { name: "Arc", mac: ["company.thebrowser.Browser"], android: ["company.thebrowser.arc"] },
  { name: "Firefox", mac: ["org.mozilla.firefox"], android: ["org.mozilla.firefox"] },
  { name: "Microsoft Edge", mac: ["com.microsoft.edgemac"], android: ["com.microsoft.emmx"] },
  { name: "Brave", mac: ["com.brave.Browser"], android: ["com.brave.browser"] },
  { name: "Signal", mac: ["org.whispersystems.signal-desktop"], android: ["org.thoughtcrime.securesms"] },
  { name: "Messenger", mac: ["com.facebook.archon"], android: ["com.facebook.orca"] },
  { name: "Microsoft Teams", mac: ["com.microsoft.teams", "com.microsoft.teams2"], android: ["com.microsoft.teams"] },
  { name: "Outlook", mac: ["com.microsoft.Outlook"], android: ["com.microsoft.office.outlook"] },
  { name: "Word", mac: ["com.microsoft.Word"], android: ["com.microsoft.office.word"] },
  { name: "Excel", mac: ["com.microsoft.Excel"], android: ["com.microsoft.office.excel"] },
  { name: "PowerPoint", mac: ["com.microsoft.Powerpoint"], android: ["com.microsoft.office.powerpoint"] },
  { name: "OneDrive", mac: ["com.microsoft.OneDrive"], android: ["com.microsoft.skydrive"] },
  { name: "Dropbox", mac: ["com.getdropbox.dropbox"], android: ["com.dropbox.android"] },
  { name: "Google Drive", mac: ["com.google.drivefs"], android: ["com.google.android.apps.docs"] },
  { name: "Tailscale", mac: ["io.tailscale.ipn.macos", "io.tailscale.ipn.macsys"], android: ["com.tailscale.ipn"] },
  { name: "Obsidian", mac: ["md.obsidian"], android: ["md.obsidian"] },
  { name: "Todoist", mac: ["com.todoist.mac.Todoist"], android: ["com.todoist"] },
  { name: "Trello", mac: ["com.atlassian.trello"], android: ["com.trello"] },
  { name: "ClickUp", mac: ["com.clickup.desktop-app"], android: ["co.mangotechnologies.clickup"] },
  { name: "Linear", mac: ["com.linear"], android: ["app.linear"] },
  { name: "ChatGPT", mac: ["com.openai.chat"], android: ["com.openai.chatgpt"] },
  { name: "Claude", mac: ["com.anthropic.claudefordesktop"], android: ["com.anthropic.claude"] },
  { name: "Perplexity", mac: ["ai.perplexity.mac"], android: ["ai.perplexity.app.android"] },
  { name: "Termius", mac: ["com.termius-dmg.mac"], android: ["com.server.auditor.ssh.client"] },
  { name: "Bitwarden", mac: ["com.bitwarden.desktop"], android: ["com.x8bit.bitwarden"] },
  { name: "Canva", mac: ["com.canva.CanvaDesktop"], android: ["com.canva.editor"] },
  { name: "CapCut", mac: ["com.lemon.lvoverseas"], android: ["com.lemon.lvoverseas"] },
  { name: "Steam", mac: ["com.valvesoftware.steam"], android: ["com.valvesoftware.android.steam.community"] },
  { name: "Line", mac: ["jp.naver.line.mac"], android: ["jp.naver.line.android"] },
  { name: "Skype", mac: ["com.skype.skype"], android: ["com.skype.raider"] },
  { name: "Netflix", mac: [], android: ["com.netflix.mediaclient"] },
  { name: "YouTube Music", mac: [], android: ["com.google.android.apps.youtube.music"] },
];

const PREFIXES = ["google ", "microsoft ", "adobe ", "the "];
const SUFFIXES = [" desktop", " for mac", " for macos", " app", " messenger", " browser"];

export function normaliseName(s: string) {
  let n = s.toLowerCase().replace(/\.app$/, "").trim();
  for (let again = true; again; ) {
    again = false;
    for (const p of PREFIXES) if (n.startsWith(p) && n.length > p.length + 2) { n = n.slice(p.length); again = true; }
    for (const x of SUFFIXES) if (n.endsWith(x) && n.length > x.length + 2) { n = n.slice(0, -x.length); again = true; }
    const m = n.match(/^(.*\S)\s+\d+$/); // "1Password 7" -> "1password"
    if (m && m[1].length > 2) { n = m[1]; again = true; }
  }
  return n.replace(/[^a-z0-9]/g, "");
}

export type Platform = "android" | "mac";
export type Candidate = { drawable: string; label: string; ids: { platform: Platform; id: string }[] };

/** Best existing drawing on the OTHER platform for a new request, or null. */
export function suggestFor(platform: Platform, id: string, label: string, candidates: Candidate[]) {
  const other: Platform = platform === "mac" ? "android" : "mac";
  const group = KNOWN_PAIRS.find((g) => (platform === "mac" ? g.mac : g.android).some((x) => x.toLowerCase() === id.toLowerCase()));
  if (group) {
    const want = new Set((other === "mac" ? group.mac : group.android).map((x) => x.toLowerCase()));
    for (const c of candidates)
      if (c.ids.some((x) => x.platform === other && want.has(x.id.toLowerCase())))
        return { drawable: c.drawable, reason: `known pair (${group.name})` };
  }
  const n = normaliseName(label);
  if (n.length >= 3) {
    for (const c of candidates)
      if (c.ids.some((x) => x.platform === other) && normaliseName(c.label) === n)
        return { drawable: c.drawable, reason: `same name ("${label}" ≈ "${c.label}")` };
  }
  return null;
}
