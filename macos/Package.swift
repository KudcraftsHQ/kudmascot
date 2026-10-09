// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "kudmascot-mac",
    platforms: [.macOS(.v13)],
    dependencies: [
        // Pinned: the mac workflow downloads the matching Sparkle tools (sign_update).
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        // Everything that touches files and the server, kept out of the UI so tests can drive it.
        .target(name: "KudMascotCore"),
        .executableTarget(
            name: "KudMascot",
            dependencies: ["KudMascotCore", .product(name: "Sparkle", package: "Sparkle")],
            // build.sh embeds Sparkle.framework in Contents/Frameworks.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        ),
        .testTarget(name: "KudMascotCoreTests", dependencies: ["KudMascotCore"]),
    ]
)
