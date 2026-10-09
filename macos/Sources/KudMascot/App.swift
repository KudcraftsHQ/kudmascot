import AppKit
import KudMascotCore
import SwiftUI

struct KudMascotApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @ObservedObject private var model = Model.shared

    var body: some Scene {
        MenuBarExtra {
            MenuView().environmentObject(model)
        } label: {
            Image(systemName: model.needsAdmin.isEmpty ? "face.smiling" : "face.smiling.inverse")
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            Model.shared.start()
            Updater.shared.start()
            if Store.token.isEmpty { SettingsWindowController.shared.show() }
        }
    }
}

/// Settings live in a plain AppKit window: reliable to bring forward from an accessory app.
@MainActor
final class SettingsWindowController {
    static let shared = SettingsWindowController()
    private var window: NSWindow?

    func show() {
        let window = self.window ?? {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 340),
                             styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "kudmascot Settings"
            w.isReleasedWhenClosed = false
            return w
        }()
        self.window = window
        if !window.isVisible {
            window.contentViewController = NSHostingController(rootView: SettingsView().environmentObject(Model.shared))
            window.center()
        }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}
