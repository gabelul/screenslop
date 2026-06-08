// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "RuntimeSmokeFeature",
    platforms: [.iOS(.v18)],
    products: [
        .library(
            name: "RuntimeSmokeFeature",
            targets: ["RuntimeSmokeFeature"]
        ),
    ],
    targets: [
        .target(name: "RuntimeSmokeFeature"),
        .testTarget(
            name: "RuntimeSmokeFeatureTests",
            dependencies: ["RuntimeSmokeFeature"]
        ),
    ]
)
