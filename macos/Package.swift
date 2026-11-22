// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "HotCrossBunsNative",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "HotCrossBunsMac", targets: ["HotCrossBunsMac"])],
    targets: [
        .target(name: "HotCrossBunsCore"),
        .executableTarget(name: "HotCrossBunsMac", dependencies: ["HotCrossBunsCore"]),
        .testTarget(name: "HotCrossBunsMacTests", dependencies: ["HotCrossBunsMac", "HotCrossBunsCore"]),
        .testTarget(name: "HotCrossBunsCoreTests", dependencies: ["HotCrossBunsCore"], resources: [.copy("Fixtures")])
    ]
)
