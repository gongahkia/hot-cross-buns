import SwiftUI

struct DataControlSection: View {
    @Environment(AppModel.self) private var model
    @State private var cachePath = ""
    @State private var cacheFootprint = "Calculating..."

    var body: some View {
        Section("Data control") {
            cloudTargets
            Divider()
            storageLocations
        }
        .task {
            await refreshStorageSummary()
        }
    }

    private var cloudTargets: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Cloud sync")
                .hcbFont(.subheadline, weight: .medium)
            ForEach(CloudSyncTarget.allCases) { target in
                Toggle(isOn: binding(for: target)) {
                    Label(target.title, systemImage: target.systemImage)
                }
                Text(target.detail)
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text("Turning a surface off keeps existing local data and queued edits on this Mac. Turning it back on resumes replay and refresh for that surface.")
                .hcbFont(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var storageLocations: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Local storage")
                .hcbFont(.subheadline, weight: .medium)
            LabeledContent("Cache") {
                Text(cacheFootprint)
                    .foregroundStyle(.secondary)
            }
            if cachePath.isEmpty == false {
                Text(cachePath)
                    .hcbFont(.caption2)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            HStack {
                Button {
                    Task { await model.openLocalCacheFolder() }
                } label: {
                    Label("Open cache", systemImage: "folder")
                }
                Button {
                    Task { await model.openLocalBackupFolder() }
                } label: {
                    Label("Open backups", systemImage: "archivebox")
                }
            }
        }
    }

    private func binding(for target: CloudSyncTarget) -> Binding<Bool> {
        Binding(
            get: { model.settings.cloudSyncTargets.contains(target) },
            set: { model.setCloudSyncTarget(target, enabled: $0) }
        )
    }

    private func refreshStorageSummary() async {
        cachePath = await model.cacheFilePath()
        cacheFootprint = await model.cacheFootprintDescription()
        await model.refreshLocalBackupSummary()
    }
}
