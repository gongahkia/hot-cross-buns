import Foundation

public enum NativeModelsArea: String, CaseIterable, Identifiable {
    case local = "Local Models"
    case api = "API-Key Providers"
    public var id: String { rawValue }
}

public struct NativeLocalModel: Decodable, Sendable, Equatable, Identifiable {
    public let id, name, tag, digest, reason, source: String
    public let family, packageSize, capabilities: String?
    public let requiredMemory, requiredDisk: UInt64?
    enum CodingKeys: String, CodingKey { case id, name, tag, digest, reason, source, size, downloaded, loaded, eligible, family, capabilities; case packageSize = "package_size", requiredMemory = "required_memory", requiredDisk = "required_disk" }
    public let size: Int64?
    public let downloaded, loaded: Bool?
    public let eligible: Bool
    public var downloadLabel: String { downloaded.map { $0 ? "Downloaded" : "Not downloaded" } ?? "Download state unknown" }
    public var loadedLabel: String { loaded.map { $0 ? "Loaded" : "Not loaded" } ?? "Loaded state unknown" }
}
public struct NativeLocalStatus: Decodable, Sendable, Equatable {
    public let configuredModel: String?
    public let startBlock, downloadBlock, selectionNote, selectionBlock: String?
    public let resultID, observedAt, runtimePath, discovery, version, ownership, endpoint, issue: String
    public let selectedProvider, selectedModel, hardwareNote, blocked: String
    public let reachable, installedKnown, loadedKnown: Bool
    public let totalMemory: UInt64
    public let availableMemory, availableDisk: UInt64?
    public let catalog, installed: [NativeLocalModel]
    enum CodingKeys: String, CodingKey {
        case discovery, version, ownership, endpoint, issue, reachable, catalog, installed, blocked
        case resultID = "result_id", observedAt = "observed_at", runtimePath = "runtime_path"
        case startBlock = "start_block", downloadBlock = "download_block", selectionNote = "selection_note", selectionBlock = "selection_block"
        case configuredModel = "configured_model"
        case selectedProvider = "selected_provider", selectedModel = "selected_model", hardwareNote = "hardware_note"
        case installedKnown = "installed_known", loadedKnown = "loaded_known", totalMemory = "total_memory"
        case availableMemory = "available_memory", availableDisk = "available_disk"
    }
    func validate() throws {
        guard !resultID.isEmpty, resultID.utf8.count <= 128, !observedAt.isEmpty,
              catalog.count <= 64, installed.count <= 256,
              Set(catalog.map(\.id)).count == catalog.count, Set(installed.map(\.id)).count == installed.count,
              (catalog + installed).allSatisfy({ model in
                  !model.id.isEmpty && [model.id, model.name, model.tag, model.digest, model.reason, model.source].allSatisfy { $0.utf8.count <= 4096 } && (model.size ?? 0) >= 0
              }),
              [runtimePath, discovery, version, ownership, endpoint, issue, selectedProvider, selectedModel, hardwareNote, blocked].allSatisfy({ $0.utf8.count <= 4096 })
        else { throw BridgeFailure("Local observation is invalid. Refresh explicitly.") }
    }
}
