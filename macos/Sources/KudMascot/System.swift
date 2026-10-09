import AppKit
import Foundation
import KudMascotCore

/// Runs a batch of icon jobs as root: one `osascript … with administrator privileges` call, so the
/// password is asked once per batch. The root process is this same binary with `--apply-icons`.
enum Admin {
    static func run(_ jobs: [IconJob]) async -> Result<Void, Error> {
        guard !jobs.isEmpty, let exe = Bundle.main.executableURL?.path else { return .success(()) }
        let manifest = FileManager.default.temporaryDirectory.appendingPathComponent("kudmascot-admin-\(UUID().uuidString).json")
        do { try JSONEncoder().encode(jobs).write(to: manifest) } catch { return .failure(error) }
        defer { try? FileManager.default.removeItem(at: manifest) }
        let shell = "\(sq(exe)) --apply-icons \(sq(manifest.path))"
        let prompt = "kudmascot needs your password to change \(jobs.count) app icon\(jobs.count == 1 ? "" : "s")."
        let script = "do shell script \"\(asEscape(shell))\" with prompt \"\(asEscape(prompt))\" with administrator privileges"
        return await Task.detached {
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            p.arguments = ["-e", script]
            let err = Pipe()
            p.standardError = err
            p.standardOutput = Pipe()
            do { try p.run() } catch { return .failure(error) }
            p.waitUntilExit()
            if p.terminationStatus == 0 { return .success(()) }
            let msg = String(decoding: err.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            return .failure(NSError(domain: "kudmascot.admin", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey: msg.trimmingCharacters(in: .whitespacesAndNewlines)]))
        }.value
    }

    /// Single-quote for /bin/sh.
    static func sq(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
    /// Escape for an AppleScript string literal.
    static func asEscape(_ s: String) -> String { s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
}

/// `killall Dock` so it redraws icons: only when something changed, debounced.
@MainActor
enum DockRefresher {
    private static var pending: Task<Void, Never>?

    static func schedule() {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
            p.arguments = ["Dock"]
            try? p.run()
            Log.write("dock: refreshed")
        }
    }
}

/// Watches the app folders (an app update replaces its bundle, which shows up as a change in the
/// folder) and calls back, debounced.
final class FolderWatcher {
    private var sources: [DispatchSourceFileSystemObject] = []
    private var debounce: DispatchWorkItem?
    private let onChange: () -> Void

    init(folders: [URL], onChange: @escaping () -> Void) {
        self.onChange = onChange
        for folder in folders {
            let fd = open(folder.path, O_EVTONLY)
            guard fd >= 0 else { continue }
            let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete, .link], queue: .main)
            src.setEventHandler { [weak self] in self?.fire() }
            src.setCancelHandler { close(fd) }
            src.resume()
            sources.append(src)
        }
    }

    private func fire() {
        debounce?.cancel()
        let work = DispatchWorkItem { [onChange] in onChange() }
        debounce = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }

    deinit { sources.forEach { $0.cancel() } }
}

enum IconPNG {
    /// The app's current icon as a 256 px PNG, for a request.
    static func current(_ app: URL, size: Int = 256) -> Data? {
        let image = NSWorkspace.shared.icon(forFile: app.path)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }
}
