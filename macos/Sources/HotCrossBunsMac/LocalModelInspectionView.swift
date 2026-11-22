import SwiftUI
import HotCrossBunsCore

struct LocalModelInspectionView: View {
    let setup: NativeProviderSetup
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                Text("Local Models").font(.title2)
                Text("Ollama runs models locally; weights require separate downloads. API-key providers remain available independently. Opening this screen starts no runtime, download or inference.").foregroundStyle(.secondary)
                if !setup.localIssue.isEmpty { NativeStatusMessage(text: setup.localIssue, severity: .warning) }
                if setup.busy { ProgressView("Waiting for Go confirmation…").controlSize(.small) }
                if let review = setup.localReview { LocalModelSelectionReviewView(setup: setup, review: review) }
                if let receipt = setup.localReceipt {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Last local selection").font(.headline)
                        Text(receipt.summary)
                        Text(verbatim: receipt.tag).font(.caption)
                        Button("Reconcile Selection") { Task { await setup.reconcileLocalSelection() } }.disabled(setup.busy)
                    }
                }
                if !setup.localNotice.isEmpty { Text(setup.localNotice).font(.callout) }
                if let status = setup.localStatus {
                    NativeLocalRuntimeDetails(status: status)
                    LocalModelOnboardingView(status: status)
                    if let blocked = status.selectionBlock, !blocked.isEmpty { NativeStatusMessage(text: blocked, severity: .warning) }
                    Text(status.selectionNote ?? "Review a verified installed model for future selection.").font(.caption).foregroundStyle(.secondary)
                    Divider()
                    Text("Downloaded models").font(.headline)
                    if !status.installedKnown { Text("Unknown · installed inventory could not be verified.") }
                    else if status.installed.isEmpty { Text("The runtime reports no downloaded models.") }
                    ForEach(status.installed) { model in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: model.tag).fontWeight(.medium)
                            Text(model.loadedLabel).foregroundStyle(.secondary)
                            Text("Size: \(model.size.map { localModelBytes(UInt64($0)) } ?? "unknown") · Digest: \(model.digest.isEmpty ? "unknown" : model.digest)").font(.caption).textSelection(.enabled)
                        }
                    }
                    Divider()
                    Text("Reviewed catalog").font(.headline)
                    Text("Eligibility is a conservative hardware check. It is not a live model test.").font(.caption).foregroundStyle(.secondary)
                    ForEach(status.catalog) { model in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: model.name).fontWeight(.medium)
                            Text(verbatim: model.tag).font(.callout).textSelection(.enabled)
                            if status.selectedProvider == "hot-cross-buns-local", status.selectedModel == model.tag { Text("Selected for future requests").font(.caption).foregroundStyle(.secondary) }
                            Text("\(model.downloadLabel) · \(model.loadedLabel)").font(.caption).foregroundStyle(.secondary)
                            Text(model.eligible ? "Passes conservative hardware check" : model.reason).font(.caption)
                            if let family = model.family { Text("Family: \(family) · Published package: \(model.packageSize ?? "unknown")").font(.caption) }
                            if let capabilities = model.capabilities { Text(capabilities).font(.caption).foregroundStyle(.secondary) }
                            if let ram = model.requiredMemory, let disk = model.requiredDisk { Text("Conservative checks: \(localModelBytes(ram)) RAM capacity · \(localModelBytes(disk)) free storage. Not measured inference requirements.").font(.caption).foregroundStyle(.secondary) }
                            if !model.digest.isEmpty { Text("Observed installed digest: \(model.digest)").font(.caption).textSelection(.enabled) }
                            HStack {
                                Button("Use This Model…") { Task { _ = await setup.prepareLocalSelection(model.id) } }
                                    .disabled(setup.busy || setup.localReview != nil || !status.reachable || status.selectionBlock?.isEmpty == false || !model.canReviewSelection)
                                    .help(model.canReviewSelection ? "Review exact installed identity and future settings" : "Requires a downloaded eligible model with a verified SHA-256 digest")
                                Button("Download Model…") {}.disabled(true).help(status.downloadBlock ?? "Cross-process model-use protection is unfinished")
                            }
                            if let url = URL(string: model.source), url.scheme == "https", url.host == "ollama.com" { Link("Catalog source", destination: url).font(.caption) }
                        }.padding(.vertical, 3)
                    }
                    Divider()
                    Text(status.blocked).font(.callout).foregroundStyle(.secondary)
                    
                } else if !setup.busy {
                    Text("No current observation. Choose Refresh Status to inspect the local runtime.").foregroundStyle(.secondary)
                }
                Text("Configured, locally ready and live verified are distinct. This view never live-tests a model. Selected models affect future requests; an active request keeps its captured model.").font(.caption).foregroundStyle(.secondary)
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
        }.accessibilityIdentifier("hot-cross-buns.models.local")
    }
}

struct NativeLocalRuntimeDetails: View {
    let status: NativeLocalStatus
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Runtime").font(.headline)
            Text(status.runtimePath.isEmpty ? "Executable not detected in the supported locations" : "Detected executable: \(status.runtimePath)")
            Text(status.reachable ? "Running endpoint: reachable · Version: \(status.version)" : "Running endpoint: unverified / unavailable")
            Text("Ownership: \(status.ownership)")
            Text("Future selection: \(status.selectedProvider.isEmpty ? "none" : status.selectedProvider) / \(status.selectedModel.isEmpty ? "none" : status.selectedModel)")
            Text("Configured local model: \(status.configuredModel.map { $0.isEmpty ? "not configured" : $0 } ?? "unknown")")
            Text("Live tested: not established by this observation")
            if !status.issue.isEmpty { NativeStatusMessage(text: status.issue, severity: .warning) }
            Text("Endpoint: \(status.endpoint.isEmpty ? "unavailable" : status.endpoint)").font(.caption).textSelection(.enabled)
            Text("Checked: \(status.discovery)").font(.caption).foregroundStyle(.secondary)
            Text("Total RAM: \(status.totalMemory == 0 ? "unknown" : localModelBytes(status.totalMemory)) · Available memory: \(status.availableMemory.map(localModelBytes) ?? "unknown") · Available disk: \(status.availableDisk.map(localModelBytes) ?? "unknown")").font(.caption)
            Text(status.hardwareNote).font(.caption).foregroundStyle(.secondary)
            Text("Observed \(status.observedAt)").font(.caption).foregroundStyle(.secondary)
        }
    }
}

private func localModelBytes(_ count: UInt64) -> String { ByteCountFormatter.string(fromByteCount: Int64(clamping: count), countStyle: .file) }

struct LocalModelOnboardingView: View {
    let status: NativeLocalStatus
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if status.runtimePath.isEmpty {
                Text("Install Ollama").font(.headline)
                Text("Ollama was not detected in the checked locations. Install it yourself from the official macOS page, then choose Refresh Status. Opening the page does not install or verify anything.")
            } else { Text("Ollama installation and runtime are separate. A detected executable is not proof that a server is running or owned by Hot Cross Buns.").font(.callout) }
            Link("Open Official Ollama macOS Installation Page", destination: URL(string: "https://ollama.com/download/mac")!)
            Text("Model weights require separate downloads. Disk, memory and context requirements vary. No installer or administrator command is run by Hot Cross Buns.").font(.caption).foregroundStyle(.secondary)
            Button("Start Local Runtime") {}.disabled(true)
            Text(status.startBlock ?? "Start is unavailable until binary/listener identity and shared runtime ownership are verified.").font(.caption).foregroundStyle(.secondary)
            Text(status.downloadBlock ?? "Downloads are unavailable until model-use leases cover retained review and recovery.").font(.caption).foregroundStyle(.secondary)
        }.accessibilityElement(children: .contain).accessibilityLabel("Local model installation and runtime guidance")
    }
}
struct LocalModelSelectionReviewView: View {
    let setup: NativeProviderSetup
    let review: NativeLocalSelectionReview
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Review Future Model Selection").font(.headline)
            Text("Model: \(review.tag)").textSelection(.enabled)
            Text("Installed digest: \(review.digest)").font(.caption).textSelection(.enabled)
            Text("Runtime destination: \(review.endpoint)").font(.callout).textSelection(.enabled)
            Text(review.notice).font(.callout)
            HStack {
                Button("Cancel") { Task { await setup.cancelLocalSelection() } }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Confirm Future Selection") { Task { _ = await setup.confirmLocalSelection() } }
                    .accessibilityIdentifier("hot-cross-buns.local.confirm-selection")
            }.disabled(setup.busy)
        }.padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("hot-cross-buns.local.selection-review")
    }
}
