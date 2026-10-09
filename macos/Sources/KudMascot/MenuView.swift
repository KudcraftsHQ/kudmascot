import AppKit
import KudMascotCore
import SwiftUI

struct MenuView: View {
    @EnvironmentObject var model: Model
    @State private var showSystem = false
    @State private var filter: Model.Kind?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            counts
            actions
            if !model.needsAdmin.isEmpty || model.adminFailed { adminBox }
            if let m = model.message {
                Text(m).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            appList
            systemList
            Divider()
            footer
        }
        .padding(12)
        .frame(width: 360)
    }

    private var header: some View {
        HStack {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 22, height: 22)
            Text("kudmascot").font(.headline)
            Spacer()
            if model.busy { ProgressView().controlSize(.small) }
            else if let t = model.lastSync {
                Text("synced \(t, style: .relative) ago").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var counts: some View {
        HStack(spacing: 6) {
            ForEach([Model.Kind.applied, .covered, .requested, .suggested, .missing], id: \.self) { k in
                Button { filter = filter == k ? nil : k } label: {
                    VStack(spacing: 1) {
                        Text("\(model.count(k))").font(.system(.title3, design: .rounded).weight(.semibold))
                        Text(k.label).font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 7).fill(filter == k ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.05)))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var actions: some View {
        HStack {
            Button("Request missing (\(model.count(.missing)))") { Task { await model.requestMissing() } }
                .disabled(model.busy || model.count(.missing) == 0)
            Spacer()
            Button("Sync now") { Task { await model.sync() } }.disabled(model.busy)
        }
    }

    private var adminBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !model.needsAdmin.isEmpty {
                Text("\(model.needsAdmin.count) app\(model.needsAdmin.count == 1 ? "" : "s") need your password (owned by root or from the App Store).")
                    .font(.callout)
                Button("Apply with password…") { Task { await model.applyWithPassword() } }.disabled(model.busy)
            }
            Text("If macOS still blocks it, allow kudmascot in System Settings → Privacy & Security → App Management.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Open App Management settings") {
                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles")!)
            }
            .buttonStyle(.link).font(.caption)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.12)))
    }

    private var appList: some View {
        let rows = model.rows.filter { filter == nil || $0.kind == filter }
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(rows) { row in AppRow(row: row) }
                if rows.isEmpty { Text("No apps here.").font(.caption).foregroundStyle(.secondary).padding(6) }
            }
        }
        .frame(height: 260)
    }

    private var systemList: some View {
        DisclosureGroup(isExpanded: $showSystem) {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(model.systemApps) { app in
                        HStack {
                            Image(nsImage: NSWorkspace.shared.icon(forFile: app.url.path)).resizable().frame(width: 16, height: 16)
                            Text(app.name).font(.caption)
                        }
                    }
                }
            }
            .frame(maxHeight: 120)
        } label: {
            Text("System apps (\(model.systemApps.count)): sealed by macOS, can't change").font(.caption).foregroundStyle(.secondary)
        }
    }

    private var footer: some View {
        HStack {
            Menu("More") {
                Button("Restore all original icons") { Task { await model.restoreAll() } }
                Divider()
                Button("Check for Updates…") { Updater.shared.checkForUpdates() }.disabled(!Updater.shared.isAvailable)
                Button("Open debug log") { NSWorkspace.shared.open(Log.url) }
            }
            .fixedSize()
            Spacer()
            Button("Settings…") { SettingsWindowController.shared.show() }
            Button("Quit") { NSApp.terminate(nil) }
        }
    }
}

struct AppRow: View {
    @EnvironmentObject var model: Model
    let row: Model.Row

    var body: some View {
        HStack(spacing: 8) {
            Image(nsImage: NSWorkspace.shared.icon(forFile: row.app.url.path)).resizable().frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 0) {
                Text(row.app.name).font(.callout).lineLimit(1)
                if let d = row.detail { Text(d).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            Spacer()
            Text(row.kind.label)
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Capsule().fill(tint.opacity(0.18)))
            Menu {
                if row.kind == .kept {
                    Button("Use the kudmascot icon again") { Task { await model.reapply(row.app) } }
                } else {
                    Button("Restore original icon") { Task { await model.restore(row.app) } }
                }
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([row.app.url]) }
            } label: { Image(systemName: "ellipsis") }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 4)
    }

    private var tint: Color {
        switch row.kind {
        case .applied: return .green
        case .covered: return .blue
        case .requested: return .gray
        case .suggested: return .purple
        case .missing: return .orange
        case .kept: return .secondary
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: Model
    @State private var server = Store.server
    @State private var token = Store.token
    @State private var saved = false

    var body: some View {
        Form {
            Section("Server") {
                TextField("Server URL", text: $server)
                SecureField("Token", text: $token)
                Text("The token is KUDMASCOT_TOKEN in ~/.config/kudmascot/env on hammas-dev. The server is on the tailnet, so Tailscale must be on.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button("Save and sync") {
                        Store.server = server.trimmingCharacters(in: .whitespacesAndNewlines)
                        Store.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
                        saved = true
                        Task { await model.sync() }
                    }
                    .keyboardShortcut(.defaultAction)
                    if saved { Text(model.message ?? "Saved").font(.caption).foregroundStyle(.secondary) }
                }
            }
            Section("General") {
                Toggle("Launch at login", isOn: Binding(get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) }))
                Text("Version \(Updater.version). Updates install automatically (Sparkle).").font(.caption).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 340)
    }
}
