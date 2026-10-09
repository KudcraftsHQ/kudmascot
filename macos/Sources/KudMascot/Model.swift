import AppKit
import Foundation
import KudMascotCore
import ServiceManagement

@MainActor
final class Model: ObservableObject {
    static let shared = Model()

    enum Kind: String, CaseIterable {
        case applied, covered, requested, suggested, missing, kept

        var label: String {
            switch self {
            case .applied: return "Applied"
            case .covered: return "Ready"
            case .requested: return "Requested"
            case .suggested: return "Suggested"
            case .missing: return "Missing"
            case .kept: return "Original"
            }
        }
    }

    struct Row: Identifiable {
        let app: ScannedApp
        let kind: Kind
        let detail: String?
        var id: String { app.id }
    }

    @Published private(set) var rows: [Row] = []
    @Published private(set) var systemApps: [ScannedApp] = []
    @Published private(set) var busy = false
    @Published private(set) var lastSync: Date?
    @Published var message: String?
    /// Jobs macOS refused for this user: root-owned or App Store apps. Retried with a password.
    @Published private(set) var needsAdmin: [IconJob] = []
    @Published private(set) var adminFailed = false
    @Published var launchAtLogin = SMAppService.mainApp.status == .enabled

    private var state = Store.load()
    private var icons: [String: MacIcon] = [:]
    private var status: [String: MacStatus] = [:]
    private var apps: [ScannedApp] = []
    private var watcher: FolderWatcher?
    private var timer: Timer?
    /// path -> (bundleId, version) for jobs waiting on the admin prompt
    private var adminMeta: [String: (String, String)] = [:]

    func start() {
        Log.rotateIfNeeded()
        rescan()
        Task { await sync() }
        watcher = FolderWatcher(folders: AppScanner.defaultFolders) { [weak self] in
            Task { @MainActor in
                Log.write("watch: app folder changed")
                await self?.sync()
            }
        }
        // Periodic: new art on the server, and icons dropped by in-place app updates.
        timer = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.sync() }
        }
    }

    func count(_ kind: Kind) -> Int { rows.filter { $0.kind == kind }.count }

    private func rescan() {
        let all = AppScanner.scan()
        apps = all.filter { !$0.isSystem }
        systemApps = all.filter(\.isSystem)
        recompute()
    }

    private func recompute() {
        rows = apps.map { app in
            let b = app.bundleId
            if state.keepOriginal.contains(b) { return Row(app: app, kind: .kept, detail: "restored by you") }
            if let icon = icons[b] {
                if let rec = state.applied[b], rec.version == icon.version, rec.path == app.url.path, IconApplier.hasCustomIcon(app.url) {
                    return Row(app: app, kind: .applied, detail: nil)
                }
                let waiting = needsAdmin.contains { $0.app == app.url.path }
                return Row(app: app, kind: .covered, detail: waiting ? "needs your password" : "not applied yet")
            }
            if let s = status[b] {
                return Row(app: app, kind: s.suggested ? .suggested : .requested, detail: s.suggested ? "same as an Android drawing?" : s.status)
            }
            return Row(app: app, kind: .missing, detail: nil)
        }
    }

    // MARK: sync

    func sync() async {
        guard !busy else { return }
        guard let api = API(base: Store.server, token: Store.token) else {
            message = APIError.notConfigured.description
            rescan()
            return
        }
        busy = true
        defer { busy = false }
        do {
            async let i = api.icons()
            async let s = api.status()
            let (ic, st) = try await (i, s)
            icons = Dictionary(ic.map { ($0.bundleId, $0) }, uniquingKeysWith: { a, _ in a })
            status = st
            message = nil
            lastSync = Date()
        } catch {
            message = String(describing: error)
            Log.write("sync: \(error)")
        }
        rescan()
        await applyAll(api: api)
    }

    private func applyAll(api: API) async {
        var changed = false
        var denied: [IconJob] = []
        adminMeta = [:]
        for app in apps {
            let b = app.bundleId
            guard let icon = icons[b], !state.keepOriginal.contains(b) else { continue }
            if let rec = state.applied[b], rec.version == icon.version, rec.path == app.url.path, IconApplier.hasCustomIcon(app.url) { continue }
            guard let png = await fetch(icon, api: api) else { continue }
            do {
                try IconApplier.apply(png: png, to: app.url)
                state.applied[b] = Applied(version: icon.version, path: app.url.path)
                changed = true
                Log.write("apply: \(b) \(icon.version)")
            } catch {
                denied.append(IconJob(app: app.url.path, png: png.path))
                adminMeta[app.url.path] = (b, icon.version)
                Log.write("apply denied: \(b): \(error)")
            }
        }
        needsAdmin = denied
        Store.save(state)
        if changed { DockRefresher.schedule() }
        recompute()
    }

    private func fetch(_ icon: MacIcon, api: API) async -> URL? {
        let dest = Store.cachedIcon(icon.bundleId, icon.version)
        if FileManager.default.fileExists(atPath: dest.path) { return dest }
        do {
            let data = try await api.download(icon.url)
            try data.write(to: dest, options: .atomic)
            return dest
        } catch {
            Log.write("download \(icon.bundleId): \(error)")
            message = "Couldn't download the icon for \(icon.bundleId)"
            return nil
        }
    }

    // MARK: actions

    func applyWithPassword() async {
        let jobs = needsAdmin
        guard !jobs.isEmpty else { return }
        busy = true
        let result = await Admin.run(jobs)
        busy = false
        var still: [IconJob] = []
        for job in jobs {
            let url = URL(fileURLWithPath: job.app)
            if IconApplier.hasCustomIcon(url), let meta = adminMeta[job.app] {
                state.applied[meta.0] = Applied(version: meta.1, path: job.app)
            } else {
                still.append(job)
            }
        }
        needsAdmin = still
        adminFailed = !still.isEmpty
        if case .failure(let e) = result { message = "Password step failed: \(e.localizedDescription)" }
        Store.save(state)
        if still.count < jobs.count { DockRefresher.schedule() }
        recompute()
    }

    func restore(_ app: ScannedApp) async {
        await restore([app])
    }

    func restoreAll() async {
        await restore(apps.filter { state.applied[$0.bundleId] != nil || IconApplier.hasCustomIcon($0.url) })
    }

    private func restore(_ list: [ScannedApp]) async {
        var denied: [IconJob] = []
        for app in list {
            state.keepOriginal.insert(app.bundleId)
            do {
                try IconApplier.restore(app.url)
                state.applied[app.bundleId] = nil
            } catch {
                denied.append(IconJob(app: app.url.path, png: nil))
            }
        }
        if !denied.isEmpty {
            _ = await Admin.run(denied)
            for job in denied where !IconApplier.hasCustomIcon(URL(fileURLWithPath: job.app)) {
                if let app = list.first(where: { $0.url.path == job.app }) { state.applied[app.bundleId] = nil }
            }
        }
        needsAdmin.removeAll { job in list.contains { $0.url.path == job.app } }
        Store.save(state)
        DockRefresher.schedule()
        recompute()
    }

    /// Undo "Restore original": let the app get its kudmascot icon again.
    func reapply(_ app: ScannedApp) async {
        state.keepOriginal.remove(app.bundleId)
        Store.save(state)
        await sync()
    }

    func requestMissing() async {
        guard let api = API(base: Store.server, token: Store.token) else { message = APIError.notConfigured.description; return }
        let missing = rows.filter { $0.kind == .missing }.map(\.app)
        guard !missing.isEmpty else { return }
        busy = true
        let reqs = missing.map { MacRequest(bundleId: $0.bundleId, name: $0.name, icon: IconPNG.current($0.url)?.base64EncodedString()) }
        do {
            // in chunks: each icon is ~30-60 KB of base64
            for chunk in stride(from: 0, to: reqs.count, by: 20).map({ Array(reqs[$0..<min($0 + 20, reqs.count)]) }) {
                try await api.request(chunk)
            }
            Log.write("requested \(reqs.count)")
            message = "Requested \(reqs.count) app\(reqs.count == 1 ? "" : "s"). They show up in the review page's Inbox."
        } catch {
            message = String(describing: error)
        }
        busy = false
        await sync()
    }

    func setLaunchAtLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            message = "Launch at login: \(error.localizedDescription)"
        }
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }
}
