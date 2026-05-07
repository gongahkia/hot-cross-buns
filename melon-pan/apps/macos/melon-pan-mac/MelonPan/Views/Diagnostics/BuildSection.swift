import SwiftUI

struct BuildSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Build", systemImage: "hammer") {
            InfoRow(title: "App version", value: viewModel.build.appVersion)
            InfoRow(title: "Build number", value: viewModel.build.buildNumber)
            InfoRow(title: "Commit SHA", value: viewModel.build.commitSHA, monospacedValue: true)
            InfoRow(title: "Build timestamp", value: viewModel.build.buildTimestamp, monospacedValue: true)
            InfoRow(title: "Rust core", value: viewModel.build.coreVersion, monospacedValue: true)
            InfoRow(title: "Runtime shared", value: viewModel.build.runtimeSharedVersion, monospacedValue: true)
        }
    }
}
