import AppKit
import XCTest
@testable import KudMascotCore

/// Builds a throwaway .app, applies an icon through the same IconApplier path the menu-bar app
/// and the admin CLI use, and checks macOS recorded it (Icon\r file + FinderInfo custom-icon bit).
final class IconApplierTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("kudmascot-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    static func makeApp(in dir: URL, name: String = "Dummy", bundleId: String = "com.example.dummy") throws -> URL {
        let app = dir.appendingPathComponent("\(name).app")
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
        let plist: [String: Any] = ["CFBundleIdentifier": bundleId, "CFBundleName": name, "CFBundleExecutable": name, "CFBundlePackageType": "APPL"]
        let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        try data.write(to: contents.appendingPathComponent("Info.plist"))
        try Data("#!/bin/sh\n".utf8).write(to: contents.appendingPathComponent("MacOS/\(name)"))
        return app
    }

    static func makePNG(at url: URL) throws {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 256, pixelsHigh: 256, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSColor(calibratedRed: 0.8, green: 0.5, blue: 0.3, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 16, y: 16, width: 224, height: 224), xRadius: 50, yRadius: 50).fill()
        NSGraphicsContext.restoreGraphicsState()
        try rep.representation(using: .png, properties: [:])!.write(to: url)
    }

    func testApplyAndRestore() throws {
        let app = try Self.makeApp(in: dir)
        let png = dir.appendingPathComponent("icon.png")
        try Self.makePNG(at: png)
        XCTAssertFalse(IconApplier.hasCustomIcon(app))

        try IconApplier.apply(png: png, to: app)
        XCTAssertTrue(IconApplier.hasIconFile(app), "Icon\\r file written into the bundle")
        XCTAssertTrue(IconApplier.finderInfoHasCustomIcon(app), "FinderInfo custom-icon bit set")
        XCTAssertTrue(IconApplier.hasCustomIcon(app))

        try IconApplier.restore(app)
        XCTAssertFalse(IconApplier.hasCustomIcon(app))
    }

    func testBatchReportsFailures() throws {
        let app = try Self.makeApp(in: dir, name: "Two", bundleId: "com.example.two")
        let png = dir.appendingPathComponent("icon.png")
        try Self.makePNG(at: png)
        let failed = IconBatch.run([IconJob(app: app.path, png: png.path), IconJob(app: app.path, png: dir.appendingPathComponent("nope.png").path)])
        XCTAssertTrue(IconApplier.hasCustomIcon(app))
        XCTAssertEqual(failed.count, 1)
    }

    func testScannerReadsBundles() throws {
        _ = try Self.makeApp(in: dir, name: "Alpha", bundleId: "com.example.alpha")
        let sub = dir.appendingPathComponent("Suite")
        try FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
        _ = try Self.makeApp(in: sub, name: "Beta", bundleId: "com.example.beta")
        let apps = AppScanner.scan(folders: [dir], system: [])
        XCTAssertEqual(apps.map(\.bundleId), ["com.example.alpha", "com.example.beta"])
    }
}
