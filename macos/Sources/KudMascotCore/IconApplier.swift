import AppKit
import Foundation

/// The one code path that changes an app's icon. The menu-bar app, the admin (root) CLI flags and
/// the CI test all go through here.
///
/// `NSWorkspace.setIcon(_:forFile:options:)` on a bundle writes an `Icon\r` file into the bundle
/// folder and sets the custom-icon bit in the folder's FinderInfo. An app update replaces the
/// bundle, which drops both, so `hasCustomIcon` is also how we notice an update.
public enum IconApplier {
    public enum Failure: Error, CustomStringConvertible {
        case unreadableImage(String)
        case denied(String)

        public var description: String {
            switch self {
            case .unreadableImage(let p): return "can't read image \(p)"
            case .denied(let p): return "macOS refused to change \(p) (owned by root, App Store app, or App Management permission)"
            }
        }
    }

    public static func apply(png: URL, to app: URL) throws {
        guard let image = NSImage(contentsOf: png) else { throw Failure.unreadableImage(png.path) }
        guard NSWorkspace.shared.setIcon(image, forFile: app.path, options: []) else { throw Failure.denied(app.path) }
        touch(app)
    }

    public static func restore(_ app: URL) throws {
        guard NSWorkspace.shared.setIcon(nil, forFile: app.path, options: []) else { throw Failure.denied(app.path) }
        touch(app)
    }

    /// True when the bundle carries a custom icon (the `Icon\r` file and the FinderInfo bit).
    public static func hasCustomIcon(_ app: URL) -> Bool {
        let iconFile = app.appendingPathComponent("Icon\r")
        guard FileManager.default.fileExists(atPath: iconFile.path) else { return false }
        return finderInfoHasCustomIcon(app)
    }

    public static func hasIconFile(_ app: URL) -> Bool {
        FileManager.default.fileExists(atPath: app.appendingPathComponent("Icon\r").path)
    }

    /// FinderInfo is 32 bytes; the Finder flags are the big-endian UInt16 at offset 8, and
    /// kHasCustomIcon is 0x0400.
    public static func finderInfoHasCustomIcon(_ url: URL) -> Bool {
        var buf = [UInt8](repeating: 0, count: 32)
        let n = getxattr(url.path, "com.apple.FinderInfo", &buf, 32, 0, 0)
        guard n >= 10 else { return false }
        return buf[8] & 0x04 != 0
    }

    /// Nudge Finder and the Dock: they cache icons by modification date.
    static func touch(_ app: URL) {
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: app.path)
    }
}

/// One entry in an admin batch (`--apply-icons manifest.json`).
public struct IconJob: Codable, Sendable {
    public var app: String
    public var png: String?   // nil = restore the original icon
    public init(app: String, png: String?) { self.app = app; self.png = png }
}

public enum IconBatch {
    /// Applies (or restores) every job; returns the paths that failed.
    public static func run(_ jobs: [IconJob]) -> [String: String] {
        var failed: [String: String] = [:]
        for job in jobs {
            let app = URL(fileURLWithPath: job.app)
            do {
                if let png = job.png { try IconApplier.apply(png: URL(fileURLWithPath: png), to: app) }
                else { try IconApplier.restore(app) }
            } catch {
                failed[job.app] = String(describing: error)
            }
        }
        return failed
    }
}
