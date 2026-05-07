import AppKit
import SwiftUI

struct HistoryEventDetail: View {
    let event: HistoryEvent
    @EnvironmentObject private var vm: HistoryViewModel
    @State private var conflictDiff: String? = nil

    var body: some View {
        Form {
            Section {
                LabeledContent("When", value: isoTimestamp(event.date))
                LabeledContent("Kind", value: event.kind.label)
                LabeledContent("Revision", value: event.revision.isEmpty ? "None" : event.revision)
                LabeledContent("Document") {
                    HStack(spacing: 6) {
                        Text(event.documentId)
                            .font(.body.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .textSelection(.enabled)
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(event.documentId, forType: .string)
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                        .buttonStyle(.borderless)
                        .help("Copy document id")
                    }
                }
            } header: {
                Text(event.message.isEmpty ? event.kind.label : event.message)
                    .font(.title3.weight(.semibold))
                    .textCase(nil)
                    .textSelection(.enabled)
            }

            if event.kind == .conflict {
                Section("Conflict diff") {
                    if let conflictDiff, !conflictDiff.isEmpty {
                        ScrollView {
                            Text(conflictDiff)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(minHeight: 160)
                    } else {
                        Text("No pre-push snapshot was found for this event.")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            DisclosureGroup("Raw JSON") {
                Text(event.rawJSONString)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(event.kind.label)
        .task(id: event.id) { await loadConflictDiff() }
    }

    private func loadConflictDiff() async {
        guard event.kind == .conflict else {
            conflictDiff = nil
            return
        }
        guard let pending = try? RuntimeBridge.docPendingSummary(
            cacheRoot: vm.cacheRoot,
            documentId: event.documentId
        ) else {
            conflictDiff = nil
            return
        }
        guard let snapshotPath = closestPrePushSnapshot(
            to: event.timestampUnix,
            paths: pending.prePushSnapshots
        ) else {
            conflictDiff = nil
            return
        }
        let currentPath = URL(fileURLWithPath: vm.cacheRoot)
            .appendingPathComponent("docs")
            .appendingPathComponent(safePathSegment(event.documentId))
            .appendingPathComponent("current.md")
            .path
        let snapshot = (try? String(contentsOfFile: snapshotPath, encoding: .utf8)) ?? ""
        let current = (try? String(contentsOfFile: currentPath, encoding: .utf8)) ?? ""
        conflictDiff = makeLineDiff(from: snapshot, to: current)
    }
}

func isoTimestamp(_ date: Date) -> String {
    ISO8601DateFormatter().string(from: date)
}

func closestPrePushSnapshot(to timestamp: UInt64, paths: [String]) -> String? {
    paths.min { lhs, rhs in
        abs(snapshotStamp(lhs) - Int64(timestamp)) < abs(snapshotStamp(rhs) - Int64(timestamp))
    }
}

private func snapshotStamp(_ path: String) -> Int64 {
    let stem = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    return Int64(stem) ?? 0
}
