import Foundation

public struct ScannedApp: Identifiable, Hashable, Sendable {
    public var id: String { url.path }
    public let url: URL
    public let bundleId: String
    public let name: String
    /// On the sealed system volume (/System/Applications): can't be changed.
    public let isSystem: Bool
}

public enum AppScanner {
    public static let ownBundleId = "com.kudcrafts.kudmascot.mac"

    public static var defaultFolders: [URL] {
        [URL(fileURLWithPath: "/Applications"),
         FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications"),
         URL(fileURLWithPath: "/Applications/Utilities")]
    }

    public static let systemFolders = [URL(fileURLWithPath: "/System/Applications"),
                                       URL(fileURLWithPath: "/System/Applications/Utilities")]

    /// Apps in the given folders (and one level of plain sub-folders, e.g. "/Applications/Microsoft Office"),
    /// deduplicated by path, sorted by name.
    public static func scan(folders: [URL] = defaultFolders, system: [URL] = systemFolders) -> [ScannedApp] {
        var seen = Set<String>()
        var out: [ScannedApp] = []
        func add(_ url: URL, isSystem: Bool) {
            let path = url.resolvingSymlinksInPath().path
            guard !seen.contains(path), let app = read(url, isSystem: isSystem) else { return }
            seen.insert(path)
            out.append(app)
        }
        for (dirs, isSystem) in [(folders, false), (system, true)] {
            for dir in dirs {
                for url in contents(dir) {
                    if url.pathExtension == "app" { add(url, isSystem: isSystem) }
                    else if isDirectory(url) {
                        for inner in contents(url) where inner.pathExtension == "app" { add(inner, isSystem: isSystem) }
                    }
                }
            }
        }
        return out.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    public static func read(_ url: URL, isSystem: Bool = false) -> ScannedApp? {
        guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier, id != ownBundleId else { return nil }
        let info = bundle.localizedInfoDictionary ?? [:]
        let base = bundle.infoDictionary ?? [:]
        let name = (info["CFBundleDisplayName"] ?? base["CFBundleDisplayName"] ?? info["CFBundleName"] ?? base["CFBundleName"]) as? String
        let fallback = url.deletingPathExtension().lastPathComponent
        return ScannedApp(url: url, bundleId: id, name: (name?.isEmpty == false ? name! : fallback), isSystem: isSystem)
    }

    static func contents(_ dir: URL) -> [URL] {
        (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
    }

    static func isDirectory(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
    }
}
