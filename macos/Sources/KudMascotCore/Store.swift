import Foundation

/// What the app remembers between launches, in ~/Library/Application Support/kudmascot/.
///   state.json   bundleId -> applied version, and the apps Hammas restored on purpose
///   token        the server bearer token (0600). A file, not the Keychain: every ad-hoc-signed
///                update would otherwise ask for Keychain access again.
///   icons/       downloaded Mac-shaped PNGs, <bundleId>-<version>.png
public struct Applied: Codable, Hashable, Sendable {
    public var version: String
    public var path: String
    public var at: Date
    public init(version: String, path: String, at: Date = Date()) { self.version = version; self.path = path; self.at = at }
}

public struct SavedState: Codable, Sendable {
    public var applied: [String: Applied] = [:]
    /// Restored by hand: never re-applied until "Apply" again.
    public var keepOriginal: Set<String> = []
    public init() {}
}

public enum Store {
    public static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("kudmascot", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    public static var iconsDirectory: URL {
        let dir = directory.appendingPathComponent("icons", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var stateURL: URL { directory.appendingPathComponent("state.json") }
    static var tokenURL: URL { directory.appendingPathComponent("token") }

    public static func load() -> SavedState {
        guard let data = try? Data(contentsOf: stateURL) else { return SavedState() }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return (try? d.decode(SavedState.self, from: data)) ?? SavedState()
    }

    public static func save(_ state: SavedState) {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? e.encode(state) { try? data.write(to: stateURL, options: .atomic) }
    }

    public static var token: String {
        get { (try? String(contentsOf: tokenURL, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        set {
            try? Data(newValue.utf8).write(to: tokenURL, options: .atomic)
            try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tokenURL.path)
        }
    }

    public static let defaultServer = "https://hammas-dev.tailaf13a.ts.net:4488"

    public static var server: String {
        get { UserDefaults.standard.string(forKey: "server") ?? defaultServer }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }

    public static func cachedIcon(_ bundleId: String, _ version: String) -> URL {
        let safe = bundleId.replacingOccurrences(of: "/", with: "_")
        return iconsDirectory.appendingPathComponent("\(safe)-\(version).png")
    }
}
