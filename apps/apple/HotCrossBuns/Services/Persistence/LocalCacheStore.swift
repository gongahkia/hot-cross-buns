import Foundation
import CryptoKit

actor LocalCacheStore {
    private let fileURL: URL?
    private let fallbackState: CachedAppState
    private var cachedState: CachedAppState
    private(set) var lastLoadWarning: String?
    private let snapshotGenerations = 3
    // §6.12 — when non-nil, cache writes encrypt and reads decrypt via AES-GCM.
    // The caller (AppModel) sets this after loading the key from Keychain.
    // When nil but the file on disk is encrypted, load returns fallback with
    // a "cache locked" warning — we never silently destroy the encrypted
    // file in case the key is recoverable later.
    private var encryptionKey: SymmetricKey?

    // B2 — events live in a sidecar file (`cache-events.json`) so the main
    // cache file stays small (~tens of KB) and most saves don't have to
    // touch the multi-MB events blob. lastEventsHash gates writes: if the
    // new state's events array hashes to the same value as the last
    // written one, the events file write is skipped entirely. Set to nil
    // on load so the first save after launch writes events unconditionally
    // (handles legacy-monolithic → split migration).
    private var lastEventsHash: Int?

    private var eventsFileURL: URL? {
        fileURL?.deletingLastPathComponent().appending(path: "cache-events.json")
    }

    // Sidecar: stores the salt used to derive the current encryption key.
    // Salts are not secret — we keep it next to the cache so re-deriving the
    // key after a Keychain wipe only requires the passphrase.
    private var saltURL: URL? {
        fileURL?.deletingLastPathComponent().appending(path: "cache-state.salt")
    }

    init(
        fileURL: URL? = LocalCacheStore.defaultCacheFileURL,
        cachedState: CachedAppState = .empty
    ) {
        self.fileURL = fileURL
        self.fallbackState = cachedState
        self.cachedState = cachedState
    }

    func setEncryptionKey(_ key: SymmetricKey?) {
        encryptionKey = key
    }

    // Loads salt from sidecar; when absent, generates a fresh one.
    func ensureSalt() -> Data {
        if let saltURL, let existing = try? Data(contentsOf: saltURL), existing.count == HCBCacheCrypto.saltBytes {
            return existing
        }
        let fresh = HCBCacheCrypto.randomSalt()
        if let saltURL {
            try? FileManager.default.createDirectory(
                at: saltURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? fresh.write(to: saltURL, options: [.atomic])
        }
        return fresh
    }

    func currentSalt() -> Data? {
        guard let saltURL, let data = try? Data(contentsOf: saltURL), data.count == HCBCacheCrypto.saltBytes else { return nil }
        return data
    }

    // Exposes the sidecar URL so the change-passphrase flow can rotate the
    // salt atomically before re-saving the cache with the new key.
    func saltFileURL() -> URL? { saltURL }

    // Called from AppModel when the user disables encryption. Rewrites the
    // current cache as plaintext + deletes the salt sidecar so a stray
    // encrypted file won't linger.
    func dropEncryption() throws {
        encryptionKey = nil
        if let saltURL {
            try? FileManager.default.removeItem(at: saltURL)
        }
        // Force a plaintext rewrite of current in-memory state.
        save(cachedState)
    }

    func loadCachedState() -> CachedAppState {
        guard let fileURL, FileManager.default.fileExists(atPath: fileURL.path) else {
            // Even the primary cache is missing — try our rotated snapshots
            // before falling all the way back to empty state.
            if let snapshot = loadFromSnapshots() {
                lastLoadWarning = "Primary cache was missing; restored from most recent snapshot."
                cachedState = snapshot
                return snapshot
            }
            return cachedState
        }

        do {
            let data = try Data(contentsOf: fileURL)
            // Try the encrypted envelope first. The envelope decodes only
            // when the top-level JSON has `encryptedV1` — plaintext caches
            // won't, so they fall through to the plain path below.
            if let envelope = try? JSONDecoder.cachedAppState.decode(EncryptedEnvelope.self, from: data) {
                guard let key = encryptionKey else {
                    lastLoadWarning = "Local cache is encrypted; unlock to read. Google remains the source of truth."
                    cachedState = fallbackState
                    return fallbackState
                }
                let plaintext = try HCBCacheCrypto.decrypt(envelope.encryptedV1, key: key)
                var state = try JSONDecoder.cachedAppState.decode(CachedAppState.self, from: plaintext)
                state = mergeEventsFromSidecar(into: state)
                lastLoadWarning = nil
                cachedState = state
                lastEventsHash = nil
                return state
            }
            var state = try JSONDecoder.cachedAppState.decode(CachedAppState.self, from: data)
            state = mergeEventsFromSidecar(into: state)
            lastLoadWarning = nil
            cachedState = state
            lastEventsHash = nil
            return state
        } catch {
            // Full decode failed — likely a schema drift in a future release.
            AppLogger.error("cache decode failed, trying snapshots", category: .cache, metadata: [
                "error": String(describing: error)
            ])
            // Try each rotated snapshot in newest-first order before
            // falling back to partial recovery of just the pending queue.
            if let fromSnapshot = loadFromSnapshots() {
                lastLoadWarning = "Primary cache was unreadable; restored from snapshot."
                AppLogger.info("cache snapshot recovered", category: .cache)
                cachedState = fromSnapshot
                return fromSnapshot
            }
            let salvagedMutations = recoverPendingMutations(from: fileURL)
            var recovered = fallbackState
            if salvagedMutations.isEmpty == false {
                recovered.pendingMutations = salvagedMutations
            }
            lastLoadWarning = salvagedMutations.isEmpty
                ? "Local cache could not be read (\(error.localizedDescription)); starting fresh."
                : "Local cache was rebuilt after a schema change. \(salvagedMutations.count) pending mutation\(salvagedMutations.count == 1 ? "" : "s") preserved."
            AppLogger.error("cache snapshots exhausted", category: .cache, metadata: [
                "salvagedMutations": String(salvagedMutations.count)
            ])
            cachedState = recovered
            return recovered
        }
    }

#if DEBUG
    func profileLoadCachedStateForBenchmark() throws -> (state: CachedAppState, profile: LocalCacheStoreLoadProfile) {
        let totalStart = DispatchTime.now().uptimeNanoseconds
        guard let fileURL, FileManager.default.fileExists(atPath: fileURL.path) else {
            let fallbackStart = DispatchTime.now().uptimeNanoseconds
            let state = loadCachedState()
            let fallbackEnd = DispatchTime.now().uptimeNanoseconds
            return (
                state,
                LocalCacheStoreLoadProfile(
                    mainReadMilliseconds: 0,
                    mainEnvelopeDecodeMilliseconds: 0,
                    mainDecryptMilliseconds: 0,
                    mainDecodeMilliseconds: 0,
                    sidecarReadMilliseconds: 0,
                    sidecarEnvelopeDecodeMilliseconds: 0,
                    sidecarDecryptMilliseconds: 0,
                    sidecarPayloadDecodeMilliseconds: 0,
                    sidecarLegacyDecodeMilliseconds: 0,
                    sidecarApplyMilliseconds: 0,
                    fallbackRecoveryMilliseconds: Self.milliseconds(from: fallbackStart, to: fallbackEnd),
                    sidecarFormat: .none,
                    totalMilliseconds: Self.milliseconds(from: totalStart, to: fallbackEnd)
                )
            )
        }

        let mainReadStart = DispatchTime.now().uptimeNanoseconds
        let data = try Data(contentsOf: fileURL)
        let mainReadEnd = DispatchTime.now().uptimeNanoseconds

        let envelopeStart = DispatchTime.now().uptimeNanoseconds
        let envelope = try? JSONDecoder.cachedAppState.decode(EncryptedEnvelope.self, from: data)
        let envelopeEnd = DispatchTime.now().uptimeNanoseconds

        let plaintext: Data
        var mainDecryptMilliseconds = 0.0
        if let envelope {
            guard let key = encryptionKey else {
                lastLoadWarning = "Local cache is encrypted; unlock to read. Google remains the source of truth."
                cachedState = fallbackState
                let totalEnd = DispatchTime.now().uptimeNanoseconds
                return (
                    fallbackState,
                    LocalCacheStoreLoadProfile(
                        mainReadMilliseconds: Self.milliseconds(from: mainReadStart, to: mainReadEnd),
                        mainEnvelopeDecodeMilliseconds: Self.milliseconds(from: envelopeStart, to: envelopeEnd),
                        mainDecryptMilliseconds: 0,
                        mainDecodeMilliseconds: 0,
                        sidecarReadMilliseconds: 0,
                        sidecarEnvelopeDecodeMilliseconds: 0,
                        sidecarDecryptMilliseconds: 0,
                        sidecarPayloadDecodeMilliseconds: 0,
                        sidecarLegacyDecodeMilliseconds: 0,
                        sidecarApplyMilliseconds: 0,
                        fallbackRecoveryMilliseconds: 0,
                        sidecarFormat: .none,
                        totalMilliseconds: Self.milliseconds(from: totalStart, to: totalEnd)
                    )
                )
            }
            let decryptStart = DispatchTime.now().uptimeNanoseconds
            plaintext = try HCBCacheCrypto.decrypt(envelope.encryptedV1, key: key)
            let decryptEnd = DispatchTime.now().uptimeNanoseconds
            mainDecryptMilliseconds = Self.milliseconds(from: decryptStart, to: decryptEnd)
        } else {
            plaintext = data
        }

        let mainDecodeStart = DispatchTime.now().uptimeNanoseconds
        var state = try JSONDecoder.cachedAppState.decode(CachedAppState.self, from: plaintext)
        let mainDecodeEnd = DispatchTime.now().uptimeNanoseconds

        let sidecar = try profileMergeEventsFromSidecar(into: state)
        state = sidecar.state
        lastLoadWarning = nil
        cachedState = state
        lastEventsHash = nil

        let totalEnd = DispatchTime.now().uptimeNanoseconds
        return (
            state,
            LocalCacheStoreLoadProfile(
                mainReadMilliseconds: Self.milliseconds(from: mainReadStart, to: mainReadEnd),
                mainEnvelopeDecodeMilliseconds: Self.milliseconds(from: envelopeStart, to: envelopeEnd),
                mainDecryptMilliseconds: mainDecryptMilliseconds,
                mainDecodeMilliseconds: Self.milliseconds(from: mainDecodeStart, to: mainDecodeEnd),
                sidecarReadMilliseconds: sidecar.profile.sidecarReadMilliseconds,
                sidecarEnvelopeDecodeMilliseconds: sidecar.profile.sidecarEnvelopeDecodeMilliseconds,
                sidecarDecryptMilliseconds: sidecar.profile.sidecarDecryptMilliseconds,
                sidecarPayloadDecodeMilliseconds: sidecar.profile.sidecarPayloadDecodeMilliseconds,
                sidecarLegacyDecodeMilliseconds: sidecar.profile.sidecarLegacyDecodeMilliseconds,
                sidecarApplyMilliseconds: sidecar.profile.sidecarApplyMilliseconds,
                fallbackRecoveryMilliseconds: 0,
                sidecarFormat: sidecar.profile.sidecarFormat,
                totalMilliseconds: Self.milliseconds(from: totalStart, to: totalEnd)
            )
        )
    }

    func profileSaveForBenchmark(_ state: CachedAppState) throws -> LocalCacheStoreSaveProfile {
        cachedState = state
        let totalStart = DispatchTime.now().uptimeNanoseconds
        guard let fileURL else {
            return .empty
        }

        let hashStart = DispatchTime.now().uptimeNanoseconds
        let newEventsHash = LocalCacheStore.hashEventPayloads(in: state)
        let writeEvents = lastEventsHash != newEventsHash
        let hashEnd = DispatchTime.now().uptimeNanoseconds

        let stripStart = DispatchTime.now().uptimeNanoseconds
        let mainState = state.withoutEventPayloads()
        let stripEnd = DispatchTime.now().uptimeNanoseconds

        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let snapshotStart = DispatchTime.now().uptimeNanoseconds
        rotateSnapshotsBeforeWrite(fileURL: fileURL)
        let snapshotEnd = DispatchTime.now().uptimeNanoseconds

        let mainEncodeStart = DispatchTime.now().uptimeNanoseconds
        let mainPayload = try JSONEncoder.cachedAppState.encode(mainState)
        let mainEncodeEnd = DispatchTime.now().uptimeNanoseconds
        let mainDisk = try encodedForDiskForBenchmark(payload: mainPayload)
        let mainWriteStart = DispatchTime.now().uptimeNanoseconds
        try mainDisk.data.write(to: fileURL, options: [.atomic])
        let mainWriteEnd = DispatchTime.now().uptimeNanoseconds

        var sidecarEncodeMilliseconds = 0.0
        var sidecarEncryptMilliseconds = 0.0
        var sidecarWriteMilliseconds = 0.0
        if writeEvents, let eventsURL = eventsFileURL {
            let sidecarEncodeStart = DispatchTime.now().uptimeNanoseconds
            let sidecarPayload = try JSONEncoder.cachedAppState.encode(CacheEventsPayload(state: state))
            let sidecarEncodeEnd = DispatchTime.now().uptimeNanoseconds
            sidecarEncodeMilliseconds = Self.milliseconds(from: sidecarEncodeStart, to: sidecarEncodeEnd)
            let sidecarDisk = try encodedForDiskForBenchmark(payload: sidecarPayload)
            sidecarEncryptMilliseconds = sidecarDisk.encryptMilliseconds
            let sidecarWriteStart = DispatchTime.now().uptimeNanoseconds
            try sidecarDisk.data.write(to: eventsURL, options: [.atomic])
            let sidecarWriteEnd = DispatchTime.now().uptimeNanoseconds
            sidecarWriteMilliseconds = Self.milliseconds(from: sidecarWriteStart, to: sidecarWriteEnd)
            lastEventsHash = newEventsHash
        }

        let totalEnd = DispatchTime.now().uptimeNanoseconds
        return LocalCacheStoreSaveProfile(
            eventsHashMilliseconds: Self.milliseconds(from: hashStart, to: hashEnd),
            stripEventsMilliseconds: Self.milliseconds(from: stripStart, to: stripEnd),
            snapshotRotationMilliseconds: Self.milliseconds(from: snapshotStart, to: snapshotEnd),
            mainEncodeMilliseconds: Self.milliseconds(from: mainEncodeStart, to: mainEncodeEnd),
            mainEncryptMilliseconds: mainDisk.encryptMilliseconds,
            mainWriteMilliseconds: Self.milliseconds(from: mainWriteStart, to: mainWriteEnd),
            sidecarShouldWrite: writeEvents,
            sidecarEncodeMilliseconds: sidecarEncodeMilliseconds,
            sidecarEncryptMilliseconds: sidecarEncryptMilliseconds,
            sidecarWriteMilliseconds: sidecarWriteMilliseconds,
            totalMilliseconds: Self.milliseconds(from: totalStart, to: totalEnd)
        )
    }
#endif

    private func loadFromSnapshots() -> CachedAppState? {
        guard let fileURL else { return nil }
        for index in 1...snapshotGenerations {
            let url = snapshotURL(at: index, basedOn: fileURL)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            guard let data = try? Data(contentsOf: url) else { continue }
            // Snapshots inherit whatever format the primary was written in
            // (plain or encrypted). Try the envelope first so encrypted
            // snapshots still recover when the key is cached.
            if let envelope = try? JSONDecoder.cachedAppState.decode(EncryptedEnvelope.self, from: data),
               let key = encryptionKey,
               let plaintext = try? HCBCacheCrypto.decrypt(envelope.encryptedV1, key: key),
               var state = try? JSONDecoder.cachedAppState.decode(CachedAppState.self, from: plaintext) {
                state = mergeEventsFromSidecar(into: state)
                return state
            }
            if var state = try? JSONDecoder.cachedAppState.decode(CachedAppState.self, from: data) {
                state = mergeEventsFromSidecar(into: state)
                return state
            }
        }
        return nil
    }

    // On-disk discriminator for an encrypted cache file. The top-level
    // `encryptedV1` key is the sole signal between plain JSON and blob JSON,
    // so plaintext caches (which never contain this key) fall through to
    // the legacy decode path cleanly.
    fileprivate struct EncryptedEnvelope: Codable {
        let encryptedV1: HCBCacheCrypto.EncryptedBlob
    }

    fileprivate struct CacheEventsPayload: Codable {
        var activeEvents: [CalendarEventMirror]
        var workspaceEventsByAccountID: [GoogleAccount.ID: [CalendarEventMirror]]

        init(activeEvents: [CalendarEventMirror], workspaceEventsByAccountID: [GoogleAccount.ID: [CalendarEventMirror]]) {
            self.activeEvents = activeEvents
            self.workspaceEventsByAccountID = workspaceEventsByAccountID
        }

        init(state: CachedAppState) {
            activeEvents = state.events
            var workspaceEvents: [GoogleAccount.ID: [CalendarEventMirror]] = [:]
            workspaceEvents.reserveCapacity(state.accountWorkspaces.count)
            for workspace in state.accountWorkspaces where workspace.accountID != state.activeAccountID {
                workspaceEvents[workspace.accountID] = workspace.events
            }
            workspaceEventsByAccountID = workspaceEvents
        }

        func applying(to state: CachedAppState) -> CachedAppState {
            var state = state
            state.events = activeEvents
            state.accountWorkspaces = state.accountWorkspaces.map { workspace in
                var workspace = workspace
                if let events = workspaceEventsByAccountID[workspace.accountID] {
                    workspace.events = events
                } else if workspace.accountID == state.activeAccountID {
                    workspace.events = activeEvents
                }
                return workspace
            }
            return state
        }
    }

    private func snapshotURL(at index: Int, basedOn fileURL: URL) -> URL {
        fileURL
            .deletingLastPathComponent()
            .appending(path: "\(fileURL.lastPathComponent).\(index)")
    }

    private func rotateSnapshotsBeforeWrite(fileURL: URL) {
        // Shift .1 → .2 → .3 → drop before writing a new primary. Must
        // run before the atomic write so if the write fails we still
        // have the previous generation intact at .1.
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        for index in stride(from: snapshotGenerations - 1, through: 1, by: -1) {
            let src = snapshotURL(at: index, basedOn: fileURL)
            let dst = snapshotURL(at: index + 1, basedOn: fileURL)
            guard FileManager.default.fileExists(atPath: src.path) else { continue }
            try? FileManager.default.removeItem(at: dst)
            try? FileManager.default.moveItem(at: src, to: dst)
        }
        let firstSnapshot = snapshotURL(at: 1, basedOn: fileURL)
        try? FileManager.default.removeItem(at: firstSnapshot)
        try? FileManager.default.copyItem(at: fileURL, to: firstSnapshot)
    }

    private func recoverPendingMutations(from fileURL: URL) -> [PendingMutation] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        struct PartialState: Decodable { var pendingMutations: [PendingMutation]? }
        if let partial = try? JSONDecoder.cachedAppState.decode(PartialState.self, from: data) {
            return partial.pendingMutations ?? []
        }
        return []
    }

    func save(_ state: CachedAppState) {
        cachedState = state

        guard let fileURL else {
            return
        }

        // B2 — split the events array into a sidecar file. Main file
        // (without events) stays small (~tens of KB); events file is only
        // rewritten when the events hash changes. For a typical mutation
        // (e.g., toggling a setting, completing a task), the multi-MB
        // events file is left untouched.
        let newEventsHash = LocalCacheStore.hashEventPayloads(in: state)
        let writeEvents = lastEventsHash != newEventsHash
        let mainState = state.withoutEventPayloads()

        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            rotateSnapshotsBeforeWrite(fileURL: fileURL)
            try writeEncryptedOrPlaintext(
                payload: try JSONEncoder.cachedAppState.encode(mainState),
                to: fileURL
            )
            if writeEvents, let eventsURL = eventsFileURL {
                try writeEncryptedOrPlaintext(
                    payload: try JSONEncoder.cachedAppState.encode(CacheEventsPayload(state: state)),
                    to: eventsURL
                )
                lastEventsHash = newEventsHash
            }
        } catch {
            // Keep the in-memory cache usable even when the filesystem write fails.
            AppLogger.warn("cache write failed", category: .cache, metadata: ["error": String(describing: error)])
        }
    }

    // Wraps payload bytes with the same envelope rules as the legacy save:
    // encrypt + envelope when a key is set; plaintext otherwise. Atomic
    // file write so a crash mid-write can't corrupt the previous content.
    private func writeEncryptedOrPlaintext(payload: Data, to url: URL) throws {
        let dataToWrite: Data
        if let key = encryptionKey {
            let salt = ensureSalt()
            let blob = try HCBCacheCrypto.encrypt(payload, key: key, salt: salt)
            dataToWrite = try JSONEncoder.cachedAppState.encode(EncryptedEnvelope(encryptedV1: blob))
        } else {
            dataToWrite = payload
        }
        try dataToWrite.write(to: url, options: [.atomic])
    }

    // If the events sidecar exists, decode it (decrypting if needed) and
    // return its events. Falls back to the events embedded in the main
    // file (legacy monolithic format) when the sidecar is missing.
    private func mergeEventsFromSidecar(into state: CachedAppState) -> CachedAppState {
        guard let eventsURL = eventsFileURL,
              FileManager.default.fileExists(atPath: eventsURL.path) else {
            return state
        }
        do {
            let raw = try Data(contentsOf: eventsURL)
            let plaintext: Data
            if let envelope = try? JSONDecoder.cachedAppState.decode(EncryptedEnvelope.self, from: raw) {
                guard let key = encryptionKey else {
                    // Sidecar is encrypted and we can't unlock — keep legacy
                    // payload to avoid silently dropping events.
                    return state
                }
                plaintext = try HCBCacheCrypto.decrypt(envelope.encryptedV1, key: key)
            } else {
                plaintext = raw
            }
            if let payload = try? JSONDecoder.cachedAppState.decode(CacheEventsPayload.self, from: plaintext) {
                return payload.applying(to: state)
            }
            let legacyEvents = try JSONDecoder.cachedAppState.decode([CalendarEventMirror].self, from: plaintext)
            return CacheEventsPayload(activeEvents: legacyEvents, workspaceEventsByAccountID: [:]).applying(to: state)
        } catch {
            AppLogger.warn("events sidecar decode failed", category: .cache, metadata: [
                "error": String(describing: error)
            ])
            return state
        }
    }

#if DEBUG
    private func profileMergeEventsFromSidecar(into state: CachedAppState) throws -> (state: CachedAppState, profile: LocalCacheStoreLoadProfile.SidecarProfile) {
        guard let eventsURL = eventsFileURL,
              FileManager.default.fileExists(atPath: eventsURL.path) else {
            return (state, .empty)
        }

        let readStart = DispatchTime.now().uptimeNanoseconds
        let raw = try Data(contentsOf: eventsURL)
        let readEnd = DispatchTime.now().uptimeNanoseconds

        let envelopeStart = DispatchTime.now().uptimeNanoseconds
        let envelope = try? JSONDecoder.cachedAppState.decode(EncryptedEnvelope.self, from: raw)
        let envelopeEnd = DispatchTime.now().uptimeNanoseconds

        let plaintext: Data
        var decryptMilliseconds = 0.0
        if let envelope {
            guard let key = encryptionKey else {
                return (
                    state,
                    LocalCacheStoreLoadProfile.SidecarProfile(
                        sidecarReadMilliseconds: Self.milliseconds(from: readStart, to: readEnd),
                        sidecarEnvelopeDecodeMilliseconds: Self.milliseconds(from: envelopeStart, to: envelopeEnd),
                        sidecarDecryptMilliseconds: 0,
                        sidecarPayloadDecodeMilliseconds: 0,
                        sidecarLegacyDecodeMilliseconds: 0,
                        sidecarApplyMilliseconds: 0,
                        sidecarFormat: .encryptedLocked
                    )
                )
            }
            let decryptStart = DispatchTime.now().uptimeNanoseconds
            plaintext = try HCBCacheCrypto.decrypt(envelope.encryptedV1, key: key)
            let decryptEnd = DispatchTime.now().uptimeNanoseconds
            decryptMilliseconds = Self.milliseconds(from: decryptStart, to: decryptEnd)
        } else {
            plaintext = raw
        }

        let payloadDecodeStart = DispatchTime.now().uptimeNanoseconds
        if let payload = try? JSONDecoder.cachedAppState.decode(CacheEventsPayload.self, from: plaintext) {
            let payloadDecodeEnd = DispatchTime.now().uptimeNanoseconds
            let applyStart = DispatchTime.now().uptimeNanoseconds
            let merged = payload.applying(to: state)
            let applyEnd = DispatchTime.now().uptimeNanoseconds
            return (
                merged,
                LocalCacheStoreLoadProfile.SidecarProfile(
                    sidecarReadMilliseconds: Self.milliseconds(from: readStart, to: readEnd),
                    sidecarEnvelopeDecodeMilliseconds: Self.milliseconds(from: envelopeStart, to: envelopeEnd),
                    sidecarDecryptMilliseconds: decryptMilliseconds,
                    sidecarPayloadDecodeMilliseconds: Self.milliseconds(from: payloadDecodeStart, to: payloadDecodeEnd),
                    sidecarLegacyDecodeMilliseconds: 0,
                    sidecarApplyMilliseconds: Self.milliseconds(from: applyStart, to: applyEnd),
                    sidecarFormat: envelope == nil ? .payload : .encryptedPayload
                )
            )
        }
        let payloadDecodeEnd = DispatchTime.now().uptimeNanoseconds

        let legacyDecodeStart = DispatchTime.now().uptimeNanoseconds
        let legacyEvents = try JSONDecoder.cachedAppState.decode([CalendarEventMirror].self, from: plaintext)
        let legacyDecodeEnd = DispatchTime.now().uptimeNanoseconds
        let applyStart = DispatchTime.now().uptimeNanoseconds
        let merged = CacheEventsPayload(activeEvents: legacyEvents, workspaceEventsByAccountID: [:]).applying(to: state)
        let applyEnd = DispatchTime.now().uptimeNanoseconds
        return (
            merged,
            LocalCacheStoreLoadProfile.SidecarProfile(
                sidecarReadMilliseconds: Self.milliseconds(from: readStart, to: readEnd),
                sidecarEnvelopeDecodeMilliseconds: Self.milliseconds(from: envelopeStart, to: envelopeEnd),
                sidecarDecryptMilliseconds: decryptMilliseconds,
                sidecarPayloadDecodeMilliseconds: Self.milliseconds(from: payloadDecodeStart, to: payloadDecodeEnd),
                sidecarLegacyDecodeMilliseconds: Self.milliseconds(from: legacyDecodeStart, to: legacyDecodeEnd),
                sidecarApplyMilliseconds: Self.milliseconds(from: applyStart, to: applyEnd),
                sidecarFormat: envelope == nil ? .legacyArray : .encryptedLegacyArray
            )
        )
    }

    private func encodedForDiskForBenchmark(payload: Data) throws -> (data: Data, encryptMilliseconds: Double) {
        guard let key = encryptionKey else {
            return (payload, 0)
        }
        let encryptStart = DispatchTime.now().uptimeNanoseconds
        let salt = ensureSalt()
        let blob = try HCBCacheCrypto.encrypt(payload, key: key, salt: salt)
        let data = try JSONEncoder.cachedAppState.encode(EncryptedEnvelope(encryptedV1: blob))
        let encryptEnd = DispatchTime.now().uptimeNanoseconds
        return (data, Self.milliseconds(from: encryptStart, to: encryptEnd))
    }

    private static func milliseconds(from start: UInt64, to end: UInt64) -> Double {
        Double(end - start) / 1_000_000
    }
#endif

    // Cheap order-sensitive fingerprint of the events array. Hashes (id,
    // etag, updatedAt) per event — same set of events in the same order
    // produces the same hash. With 17k events this runs in ~1ms.
    // Internal (not fileprivate) so tests can verify the exact bust /
    // skip semantics independently of the actor's save path.
    static func hashEvents(_ events: [CalendarEventMirror]) -> Int {
        var hasher = Hasher()
        hasher.combine(events.count)
        for event in events {
            hasher.combine(event.id)
            hasher.combine(event.etag)
            hasher.combine(event.updatedAt)
        }
        return hasher.finalize()
    }

    static func hashEventPayloads(in state: CachedAppState) -> Int {
        var hasher = Hasher()
        hasher.combine(hashEvents(state.events))
        for workspace in state.accountWorkspaces.sorted(by: { $0.accountID < $1.accountID }) {
            hasher.combine(workspace.accountID)
            hasher.combine(hashEvents(workspace.events))
        }
        return hasher.finalize()
    }

    func cacheFilePath() -> String? {
        fileURL?.path
    }

    func cacheFootprintBytes() -> Int64 {
        [
            fileURL,
            eventsFileURL,
            saltURL
        ]
        .compactMap { $0 }
        .reduce(Int64(0)) { partial, url in
            partial + Self.fileSize(at: url)
        }
    }

    private static func fileSize(at url: URL) -> Int64 {
        guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]) else { return 0 }
        return Int64(values.fileSize ?? 0)
    }
}

#if DEBUG
struct LocalCacheStoreLoadProfile: Sendable {
    enum SidecarFormat: String, Sendable {
        case none
        case payload
        case legacyArray
        case encryptedPayload
        case encryptedLegacyArray
        case encryptedLocked
    }

    struct SidecarProfile: Sendable {
        var sidecarReadMilliseconds: Double
        var sidecarEnvelopeDecodeMilliseconds: Double
        var sidecarDecryptMilliseconds: Double
        var sidecarPayloadDecodeMilliseconds: Double
        var sidecarLegacyDecodeMilliseconds: Double
        var sidecarApplyMilliseconds: Double
        var sidecarFormat: SidecarFormat

        static let empty = SidecarProfile(
            sidecarReadMilliseconds: 0,
            sidecarEnvelopeDecodeMilliseconds: 0,
            sidecarDecryptMilliseconds: 0,
            sidecarPayloadDecodeMilliseconds: 0,
            sidecarLegacyDecodeMilliseconds: 0,
            sidecarApplyMilliseconds: 0,
            sidecarFormat: .none
        )
    }

    var mainReadMilliseconds: Double
    var mainEnvelopeDecodeMilliseconds: Double
    var mainDecryptMilliseconds: Double
    var mainDecodeMilliseconds: Double
    var sidecarReadMilliseconds: Double
    var sidecarEnvelopeDecodeMilliseconds: Double
    var sidecarDecryptMilliseconds: Double
    var sidecarPayloadDecodeMilliseconds: Double
    var sidecarLegacyDecodeMilliseconds: Double
    var sidecarApplyMilliseconds: Double
    var fallbackRecoveryMilliseconds: Double
    var sidecarFormat: SidecarFormat
    var totalMilliseconds: Double
}

struct LocalCacheStoreSaveProfile: Sendable {
    var eventsHashMilliseconds: Double
    var stripEventsMilliseconds: Double
    var snapshotRotationMilliseconds: Double
    var mainEncodeMilliseconds: Double
    var mainEncryptMilliseconds: Double
    var mainWriteMilliseconds: Double
    var sidecarShouldWrite: Bool
    var sidecarEncodeMilliseconds: Double
    var sidecarEncryptMilliseconds: Double
    var sidecarWriteMilliseconds: Double
    var totalMilliseconds: Double

    static let empty = LocalCacheStoreSaveProfile(
        eventsHashMilliseconds: 0,
        stripEventsMilliseconds: 0,
        snapshotRotationMilliseconds: 0,
        mainEncodeMilliseconds: 0,
        mainEncryptMilliseconds: 0,
        mainWriteMilliseconds: 0,
        sidecarShouldWrite: false,
        sidecarEncodeMilliseconds: 0,
        sidecarEncryptMilliseconds: 0,
        sidecarWriteMilliseconds: 0,
        totalMilliseconds: 0
    )
}
#endif

private extension LocalCacheStore {
    static var defaultCacheFileURL: URL? {
        guard let appSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return nil
        }

        let appDirectoryName = Bundle.main.bundleIdentifier ?? "HotCrossBuns"
        return appSupportURL
            .appending(path: appDirectoryName, directoryHint: .isDirectory)
            .appending(path: "cache-state.json")
    }
}

private extension JSONDecoder {
    static var cachedAppState: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var cachedAppState: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        // Debug keeps pretty + sorted for easier manual inspection of the
        // cache file. Release drops both: pretty-print roughly doubles the
        // encoded size and sortedKeys adds a sort pass per nested container,
        // which dominates at 10k+ events.
        #if DEBUG
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        #endif
        return encoder
    }
}
