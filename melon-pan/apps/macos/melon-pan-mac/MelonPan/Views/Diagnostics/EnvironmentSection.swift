import SwiftUI

struct EnvironmentSection: View {
    @ObservedObject var viewModel: DiagnosticsViewModel

    var body: some View {
        SectionContainer(title: "Environment", systemImage: "desktopcomputer") {
            InfoRow(title: "macOS", value: viewModel.environment.osVersion)
            InfoRow(title: "Hardware", value: viewModel.environment.hardwareModel, monospacedValue: true)
            InfoRow(title: "CPU arch", value: viewModel.environment.cpuArch, monospacedValue: true)
            InfoRow(title: "Locale", value: viewModel.environment.locale, monospacedValue: true)
            InfoRow(title: "Screen scale", value: viewModel.environment.screenScale == 0 ? "" : "\(viewModel.environment.screenScale)")
            InfoRow(title: "Thermal state", value: viewModel.environment.thermalState)
            InfoRow(title: "Low power mode", value: viewModel.environment.lowPowerMode ? "on" : "off")
            InfoRow(title: "Display backend", value: "Quartz")
            InfoRow(title: "Notifications", value: viewModel.environment.notificationAuthorization)
        }
    }
}
