import Foundation
import KudMascotCore

/// Append-only debug log at ~/Library/Application Support/kudmascot/debug.log. Never logs the token.
enum Log {
    private static let queue = DispatchQueue(label: "com.kudcrafts.kudmascot.log")
    static var url: URL { Store.directory.appendingPathComponent("debug.log") }

    static func write(_ line: String) {
        let data = Data("\(ISO8601DateFormatter().string(from: Date())) \(line)\n".utf8)
        let url = self.url
        queue.async {
            if let h = try? FileHandle(forWritingTo: url) {
                defer { try? h.close() }
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: data)
            } else {
                try? data.write(to: url)
            }
        }
    }

    static func rotateIfNeeded() {
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        if size > 512 * 1024 { try? FileManager.default.removeItem(at: url) }
    }
}
