import AppKit
import Sparkle

/// Sparkle 2: EdDSA-signed updates. The feed is the `appcast.xml` asset of the rolling
/// `mac-appcast` GitHub release (`SUFeedURL`), which never becomes the repo's "latest" release,
/// so Obtainium keeps tracking the Android APK.
@MainActor
final class Updater {
    static let shared = Updater()
    private var controller: SPUStandardUpdaterController?

    func start() {
        guard controller == nil,
              Bundle.main.bundleURL.pathExtension == "app",
              Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil else { return }
        controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        Log.write("updater: started (version \(Self.version))")
    }

    var isAvailable: Bool { controller != nil }

    func checkForUpdates() {
        guard let controller else { return }
        NSApp.activate(ignoringOtherApps: true)
        controller.checkForUpdates(nil)
    }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    }
}
