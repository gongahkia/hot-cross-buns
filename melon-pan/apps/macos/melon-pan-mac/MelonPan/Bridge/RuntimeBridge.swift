// Swift bridge over the melon-pan-mac-ffi C ABI.
//
// Goals:
//   - Wrap raw `UnsafeMutablePointer<CChar>` returns in `defer`-driven
//     free calls so memory leaks don't slip past code review.
//   - Decode JSON returns (PullReport, PushReport, DrainReport) into
//     Codable structs the rest of the app uses idiomatically.
//   - Translate FFI errors (NULL return + thread-local message) into
//     `RuntimeBridgeError` so callers can pattern-match.
//
// Every entry is annotated with the FFI function it wraps so jumping
// between the Rust side and the Swift call site is one cmd-click.

import Foundation

public enum RuntimeBridgeError: Error, CustomStringConvertible {
    case nullArgument(String)
    case ffi(String)
    case decode(String)

    public var description: String {
        switch self {
        case .nullArgument(let detail): return "null argument: \(detail)"
        case .ffi(let detail): return "ffi: \(detail)"
        case .decode(let detail): return "decode: \(detail)"
        }
    }
}

enum UserFacingError {
    static func message(from error: Error) -> String {
        message(from: String(describing: error))
    }

    static func message(from raw: String) -> String {
        let detail = raw
            .replacingOccurrences(of: "ffi: ", with: "")
            .replacingOccurrences(of: "refresh_drive_tree failed: ", with: "")
            .replacingOccurrences(of: "pull_document failed: ", with: "")
            .replacingOccurrences(of: "push_document failed: ", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if detail.localizedCaseInsensitiveContains("SERVICE_DISABLED")
            || detail.localizedCaseInsensitiveContains("has not been used in project")
            || detail.localizedCaseInsensitiveContains("is disabled") {
            if detail.localizedCaseInsensitiveContains("drive.googleapis.com")
                || detail.localizedCaseInsensitiveContains("Google Drive API") {
                return "Google Drive API is disabled for this OAuth project. Enable it in Google Cloud Console, wait a few minutes, then refresh again."
            }
            if detail.localizedCaseInsensitiveContains("docs.googleapis.com")
                || detail.localizedCaseInsensitiveContains("Google Docs API") {
                return "Google Docs API is disabled for this OAuth project. Enable it in Google Cloud Console, wait a few minutes, then try again."
            }
            return "A required Google API is disabled for this OAuth project. Enable it in Google Cloud Console, wait a few minutes, then try again."
        }

        if let googleMessage = googleErrorMessage(from: detail) {
            return collapseWhitespace(googleMessage)
        }

        return collapseWhitespace(detail)
    }

    private static func googleErrorMessage(from detail: String) -> String? {
        guard let start = detail.firstIndex(of: "{") else { return nil }
        let jsonText = String(detail[start...])
        guard let data = jsonText.data(using: .utf8),
              let envelope = try? JSONDecoder().decode(GoogleErrorEnvelope.self, from: data),
              let message = envelope.error?.message,
              !message.isEmpty
        else {
            return nil
        }
        return message
    }

    private static func collapseWhitespace(_ value: String) -> String {
        value
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    private struct GoogleErrorEnvelope: Decodable {
        let error: GoogleError?
    }

    private struct GoogleError: Decodable {
        let message: String?
    }
}

enum GoogleScopeSupport {
    static func canListDrive(_ metadata: RuntimeBridge.TokenMetadata?) -> Bool {
        guard let metadata else { return false }
        let scopes = Set(metadata.scope.split(separator: " ").map(String.init))
        return scopes.contains("https://www.googleapis.com/auth/drive")
            || scopes.contains("https://www.googleapis.com/auth/drive.readonly")
            || scopes.contains("https://www.googleapis.com/auth/drive.metadata.readonly")
    }

    static let missingDriveListScopeMessage =
        "This Google token cannot list your Drive. Sign in with Google again and approve Drive metadata access, then refresh Drive."

    static func canListComments(_ metadata: RuntimeBridge.TokenMetadata?) -> Bool {
        guard let metadata else { return false }
        let scopes = Set(metadata.scope.split(separator: " ").map(String.init))
        return scopes.contains("https://www.googleapis.com/auth/drive")
            || scopes.contains("https://www.googleapis.com/auth/drive.readonly")
            || scopes.contains("https://www.googleapis.com/auth/drive.file")
    }

    static let missingCommentsScopeMessage =
        "This Google token cannot read Drive comments. Sign in with Google again and approve Drive read access."
}

public enum RuntimeBridge {
    public static var errorReporter: ((RuntimeBridgeError, String) -> Void)?

    // MARK: - Platform paths

    /// Wraps `melon_pan_default_cache_root`. Resolves to
    /// `~/Library/Caches/MelonPan` unless `MELON_PAN_CACHE_ROOT` is
    /// set in the launch environment.
    public static func defaultCacheRoot() -> String {
        guard let raw = melon_pan_default_cache_root() else { return "" }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    /// Wraps `melon_pan_default_credentials_path`. Resolves to
    /// `~/Library/Application Support/MelonPan/credentials.json`.
    public static func defaultCredentialsPath() -> String {
        guard let raw = melon_pan_default_credentials_path() else { return "" }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    // MARK: - Cache init

    /// Wraps `melon_pan_init_cache`. Throws on failure with the
    /// underlying Rust error message.
    public static func initializeCache(at root: String) throws {
        let success = root.withCString { rootPtr in
            melon_pan_init_cache(rootPtr) == 1
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "unknown")
        }
    }

    // MARK: - Settings

    public static func loadSettings(cacheRoot: String) throws -> AppSettings {
        let raw = cacheRoot.withCString { root in
            melon_pan_load_settings(root)
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "load_settings failed")
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try AppSettingsSerializer.decode(json)
        } catch {
            throw RuntimeBridgeError.decode(
                "loadSettings: \(error.localizedDescription); raw=\(json)"
            )
        }
    }

    public static func saveSettings(
        cacheRoot: String,
        settings: AppSettings
    ) throws {
        let json = AppSettingsSerializer.encode(settings)
        let success = cacheRoot.withCString { root in
            json.withCString { jsonPtr in
                melon_pan_save_settings(root, jsonPtr) == 1
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "save_settings failed")
        }
    }

    public static func rekeyCache(
        cacheRoot: String,
        oldPass: String,
        newPass: String
    ) throws {
        let success = cacheRoot.withCString { root in
            oldPass.withCString { oldPtr in
                newPass.withCString { newPtr in
                    melon_pan_rekey_cache(root, oldPtr, newPtr) == 1
                }
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "rekey_cache failed")
        }
    }

    public static func clearAccount(account: String) throws {
        let success = account.withCString { acct in
            melon_pan_clear_account(acct) == 1
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "clear_account failed")
        }
    }

    // MARK: - Sync ops

    public struct PullReport: Codable {
        public let documentId: String
        public let revisionId: String
        public let bodyEndIndex: UInt32
        public let title: String
        public let plainText: String
    }

    public struct CommentRefreshReport: Codable {
        public let documentId: String
        public let commentCount: UInt
    }

    public struct DriveCommentBundle: Codable {
        public let documentId: String
        public let fetchedAt: String?
        public let comments: [DriveComment]
    }

    public struct DriveComment: Codable, Identifiable, Equatable {
        public let id: String
        public let author: DriveCommentAuthor?
        public let content: String
        public let htmlContent: String
        public let anchor: String?
        public let quotedFileContent: DriveCommentQuotedFileContent?
        public let resolved: Bool
        public let createdTime: String?
        public let modifiedTime: String?
        public let replies: [DriveCommentReply]
    }

    public struct DriveCommentAuthor: Codable, Equatable {
        public let displayName: String
        public let emailAddress: String?
        public let photoLink: String?
        public let me: Bool
    }

    public struct DriveCommentQuotedFileContent: Codable, Equatable {
        public let mimeType: String
        public let value: String
    }

    public struct DriveCommentReply: Codable, Identifiable, Equatable {
        public let id: String
        public let author: DriveCommentAuthor?
        public let content: String
        public let htmlContent: String
        public let createdTime: String?
        public let modifiedTime: String?
        public let deleted: Bool
    }

    public struct PushReport: Codable {
        public let outcome: PushOutcome
        public let fidelityWarnings: [FidelityWarning]
    }

    public struct PushOutcome: Codable {
        public let kind: String
        public let revisionBefore: String?
        public let revisionAfter: String?
        public let plainText: String?
        public let pendingPath: String?
        public let message: String?
    }

    public struct FidelityWarning: Codable {
        public let kind: String
        public let message: String
    }

    public struct DrainReport: Codable {
        public let clearedPending: UInt
        public let revisionAfter: String
    }

    public struct ConflictReport: Codable, Equatable {
        public let documentId: String
        public let baseRevisionId: String
        public let remoteRevisionId: String
        public let autoMerge: [ConflictRegion]
        public let localWins: [ConflictRegion]
        public let remoteWins: [ConflictRegion]
        public let userDecision: [ConflictRegion]
        public let destructive: [DestructiveConflict]
        public let hasUserWork: Bool
    }

    public struct ConflictRegion: Codable, Equatable, Identifiable {
        public let id: String
        public let kind: String
        public let nodeId: String
        public let title: String
        public let baseText: String
        public let localText: String
        public let remoteText: String
        public let localOperationIds: [String]
        public let tableId: String?
        public let rowIndex: UInt32?
        public let columnIndex: UInt32?
        public let rowSpan: UInt32?
        public let columnSpan: UInt32?
    }

    public struct DestructiveConflict: Codable, Equatable, Identifiable {
        public let id: String
        public let kind: String
        public let nodeId: String
        public let title: String
        public let reason: String
        public let localOperationIds: [String]
        public let tableId: String?
        public let rowIndex: UInt32?
        public let columnIndex: UInt32?
        public let rowSpan: UInt32?
        public let columnSpan: UInt32?
    }

    public struct ConflictResolutionReport: Codable, Equatable {
        public let canceledOperations: Int
        public let remainingPending: Bool
    }

    public struct ImportResult: Codable, Equatable {
        public let sourcePath: String
        public let draftId: String
        public let pushedDocumentId: String?
        public let status: String
        public let error: String?
        public let warnings: [String]
    }

    /// Wraps `melon_pan_write_current_markdown`. Persists the
    /// editor's buffer into `<cache>/docs/<id>/current.md`,
    /// archiving the previous file to trash so the operation is
    /// reversible. Throws on failure.
    public static func writeCurrentMarkdown(
        cacheRoot: String,
        documentId: String,
        markdown: String
    ) throws {
        let success = cacheRoot.withCString { rootPtr in
            documentId.withCString { docPtr in
                markdown.withCString { mdPtr in
                    melon_pan_write_current_markdown(rootPtr, docPtr, mdPtr) == 1
                }
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "write_current_markdown failed"
            )
        }
    }

    public static func pullDocument(
        accessToken: String,
        documentId: String,
        cacheRoot: String
    ) throws -> PullReport {
        let raw = accessToken.withCString { token in
            documentId.withCString { docId in
                cacheRoot.withCString { root in
                    melon_pan_pull_document(token, docId, root)
                }
            }
        }
        guard let raw else {
            let error = RuntimeBridgeError.ffi(lastError() ?? "pull_document failed")
            errorReporter?(error, "pull:\(documentId)")
            throw error
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                PullReport.self,
                from: Data(json.utf8)
            )
        } catch {
            let bridgeError = RuntimeBridgeError.decode(
                "pullDocument: \(error.localizedDescription); raw=\(json)"
            )
            errorReporter?(bridgeError, "pull:\(documentId)")
            throw bridgeError
        }
    }

    public static func refreshComments(
        accessToken: String,
        documentId: String,
        cacheRoot: String
    ) throws -> CommentRefreshReport {
        let raw = accessToken.withCString { token in
            documentId.withCString { docId in
                cacheRoot.withCString { root in
                    melon_pan_refresh_comments(token, docId, root)
                }
            }
        }
        guard let raw else {
            let error = RuntimeBridgeError.ffi(lastError() ?? "refresh_comments failed")
            errorReporter?(error, "comments:\(documentId)")
            throw error
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(CommentRefreshReport.self, raw: raw, context: "refreshComments")
    }

    public static func loadComments(
        cacheRoot: String,
        documentId: String
    ) throws -> DriveCommentBundle {
        let raw = cacheRoot.withCString { root in
            documentId.withCString { docId in
                melon_pan_load_comments(root, docId)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "load_comments failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(DriveCommentBundle.self, raw: raw, context: "loadComments")
    }

    public static func pushDocument(
        accessToken: String,
        documentId: String,
        cacheRoot: String
    ) throws -> PushReport {
        let raw = accessToken.withCString { token in
            documentId.withCString { docId in
                cacheRoot.withCString { root in
                    melon_pan_push_document(token, docId, root)
                }
            }
        }
        guard let raw else {
            let error = RuntimeBridgeError.ffi(lastError() ?? "push_document failed")
            errorReporter?(error, "push:\(documentId)")
            throw error
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                PushReport.self,
                from: Data(json.utf8)
            )
        } catch {
            let bridgeError = RuntimeBridgeError.decode(
                "pushDocument: \(error.localizedDescription); raw=\(json)"
            )
            errorReporter?(bridgeError, "push:\(documentId)")
            throw bridgeError
        }
    }

    public static func drainPending(
        accessToken: String,
        documentId: String,
        cacheRoot: String
    ) throws -> DrainReport {
        let raw = accessToken.withCString { token in
            documentId.withCString { docId in
                cacheRoot.withCString { root in
                    melon_pan_drain_pending(token, docId, root)
                }
            }
        }
        guard let raw else {
            let error = RuntimeBridgeError.ffi(lastError() ?? "drain_pending failed")
            errorReporter?(error, "drain:\(documentId)")
            throw error
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                DrainReport.self,
                from: Data(json.utf8)
            )
        } catch {
            let bridgeError = RuntimeBridgeError.decode(
                "drainPending: \(error.localizedDescription); raw=\(json)"
            )
            errorReporter?(bridgeError, "drain:\(documentId)")
            throw bridgeError
        }
    }

    /// Load the cached rich document, parsed and serialized for Swift.
    /// Returns nil when the cache file is missing (doc not yet pulled);
    /// throws on parse / FFI failure.
    public static func loadRichDocumentForSwift(
        cacheRoot: String,
        documentId: String
    ) throws -> String? {
        let raw = cacheRoot.withCString { root in
            documentId.withCString { docId in
                melon_pan_load_rich_document_for_swift(root, docId)
            }
        }
        guard let raw else {
            // Distinguish "no cache yet" from "FFI exploded": the FFI
            // sets last_error in both cases. The runtime sets the message
            // to a `read_current_docs_json` prefix when the file is just
            // missing, so we surface nil there and throw otherwise.
            if let message = lastError(),
               message.contains("read_current_docs_json") {
                return nil
            }
            throw RuntimeBridgeError.ffi(
                lastError() ?? "load_rich_document_for_swift failed"
            )
        }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    /// Append a single operation envelope to the doc's operation log.
    /// Caller serializes the envelope; the FFI parses + persists.
    public static func appendOperationEnvelope(
        cacheRoot: String,
        documentId: String,
        envelopeJson: String
    ) throws {
        let ok = cacheRoot.withCString { root in
            documentId.withCString { docId in
                envelopeJson.withCString { env in
                    melon_pan_append_operation_envelope(root, docId, env)
                }
            }
        }
        if ok != 1 {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "append_operation_envelope failed"
            )
        }
    }

    /// Archive + clear the doc's operation log. Used when the user
    /// picks "Discard local edits" in the revision-rejected recovery
    /// flow.
    public static func discardPendingOps(
        cacheRoot: String,
        documentId: String
    ) throws {
        let ok = cacheRoot.withCString { root in
            documentId.withCString { docId in
                melon_pan_discard_pending_ops(root, docId)
            }
        }
        if ok != 1 {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "discard_pending_ops failed"
            )
        }
    }

    /// True when the operation log holds at least one queued op. Drives
    /// the Save button enabled state.
    public static func hasPendingOps(
        cacheRoot: String,
        documentId: String
    ) -> Bool {
        let result = cacheRoot.withCString { root in
            documentId.withCString { docId in
                melon_pan_has_pending_ops(root, docId)
            }
        }
        return result == 1
    }

    public static func classifyConflict(
        cacheRoot: String,
        documentId: String
    ) throws -> ConflictReport {
        let raw = cacheRoot.withCString { root in
            documentId.withCString { docId in
                melon_pan_classify_conflict(root, docId)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "classify_conflict failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(ConflictReport.self, raw: raw, context: "classifyConflict")
    }

    public static func resolveConflict(
        cacheRoot: String,
        documentId: String,
        decisions: [String: String],
        manualTexts: [String: String] = [:]
    ) throws -> ConflictResolutionReport {
        let decisionObjects = decisions.map { regionId, decision in
            var object = [
                "regionId": regionId,
                "decision": decision
            ]
            if let manualText = manualTexts[regionId] {
                object["manualText"] = manualText
            }
            return object
        }
        let payload = ["decisions": decisionObjects]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [])
        let json = String(decoding: data, as: UTF8.self)
        let raw = cacheRoot.withCString { root in
            documentId.withCString { docId in
                json.withCString { payloadPtr in
                    melon_pan_resolve_conflict(root, docId, payloadPtr)
                }
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "resolve_conflict failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(
            ConflictResolutionReport.self,
            raw: raw,
            context: "resolveConflict"
        )
    }

    public static func importMarkdownFile(
        cacheRoot: String,
        sourcePath: String,
        targetDraftId: String,
        options: ImportOptions,
        accessToken: String?
    ) throws -> ImportResult {
        let optionsJSON = try encodeImportOptions(options)
        let raw = cacheRoot.withCString { root in
            sourcePath.withCString { source in
                targetDraftId.withCString { target in
                    optionsJSON.withCString { optionsPtr in
                        if let accessToken {
                            return accessToken.withCString { token in
                                melon_pan_import_markdown_file(
                                    root,
                                    source,
                                    target,
                                    optionsPtr,
                                    token
                                )
                            }
                        }
                        return melon_pan_import_markdown_file(
                            root,
                            source,
                            target,
                            optionsPtr,
                            nil
                        )
                    }
                }
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "import_markdown_file failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(ImportResult.self, raw: raw, context: "importMarkdownFile")
    }

    public static func importMarkdownDir(
        cacheRoot: String,
        dir: String,
        recursive: Bool,
        options: ImportOptions,
        accessToken: String?
    ) throws -> [ImportResult] {
        let optionsJSON = try encodeImportOptions(options)
        let raw = cacheRoot.withCString { root in
            dir.withCString { dirPtr in
                optionsJSON.withCString { optionsPtr in
                    if let accessToken {
                        return accessToken.withCString { token in
                            melon_pan_import_markdown_dir(
                                root,
                                dirPtr,
                                recursive ? 1 : 0,
                                optionsPtr,
                                token
                            )
                        }
                    }
                    return melon_pan_import_markdown_dir(
                        root,
                        dirPtr,
                        recursive ? 1 : 0,
                        optionsPtr,
                        nil
                    )
                }
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "import_markdown_dir failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON([ImportResult].self, raw: raw, context: "importMarkdownDir")
    }

    // MARK: - Templates

    public static func templatesList(cacheRoot: String) throws -> [TemplateInfo] {
        let raw = cacheRoot.withCString { root in
            melon_pan_templates_list(root)
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "templates_list failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeTemplateJSON([TemplateInfo].self, raw: raw, context: "templatesList")
    }

    public static func templateSave(cacheRoot: String, template: MarkdownTemplate) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let json: String
        do {
            json = String(decoding: try encoder.encode(template), as: UTF8.self)
        } catch {
            throw RuntimeBridgeError.decode("templateSave: \(error.localizedDescription)")
        }
        let success = cacheRoot.withCString { root in
            json.withCString { templatePtr in
                melon_pan_template_save(root, templatePtr) == 1
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "template_save failed")
        }
    }

    public static func templateDelete(cacheRoot: String, id: UUID) throws {
        let success = cacheRoot.withCString { root in
            id.uuidString.withCString { idPtr in
                melon_pan_template_delete(root, idPtr) == 1
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "template_delete failed")
        }
    }

    public static func templateLoad(cacheRoot: String, id: UUID) throws -> MarkdownTemplate {
        let raw = cacheRoot.withCString { root in
            id.uuidString.withCString { idPtr in
                melon_pan_template_load(root, idPtr)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "template_load failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeTemplateJSON(MarkdownTemplate.self, raw: raw, context: "templateLoad")
    }

    public static func templateExpand(
        body: String,
        title: String,
        author: String
    ) throws -> String {
        let raw = body.withCString { bodyPtr in
            title.withCString { titlePtr in
                author.withCString { authorPtr in
                    melon_pan_template_expand(bodyPtr, titlePtr, authorPtr)
                }
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "template_expand failed")
        }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    public static func refreshDriveTree(
        accessToken: String,
        parentId: String?,
        cacheRoot: String
    ) throws -> Int64 {
        let result = accessToken.withCString { token in
            cacheRoot.withCString { root in
                if let parentId {
                    return parentId.withCString { parent in
                        melon_pan_refresh_drive_tree(token, parent, root)
                    }
                } else {
                    return melon_pan_refresh_drive_tree(token, nil, root)
                }
            }
        }
        if result < 0 {
            let error = RuntimeBridgeError.ffi(lastError() ?? "refresh_drive_tree failed")
            errorReporter?(error, "refreshDriveTree")
            throw error
        }
        return result
    }

    // MARK: - Auth

    public static func ensureFreshAccessToken(
        credentialsPath: String,
        account: String,
        leewaySeconds: UInt64
    ) throws -> String {
        if let raw = account.withCString({
            melon_pan_ensure_fresh_access_token_with_saved_oauth_client($0, leewaySeconds)
        }) {
            defer { melon_pan_string_free(raw) }
            return String(cString: raw)
        }
        _ = lastError()
        let raw = credentialsPath.withCString { creds in
            account.withCString { acct in
                melon_pan_ensure_fresh_access_token(creds, acct, leewaySeconds)
            }
        }
        guard let raw else {
            let error = RuntimeBridgeError.ffi(
                lastError() ?? "ensure_fresh_access_token failed"
            )
            errorReporter?(error, "ensureFreshAccessToken")
            throw error
        }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    public static func saveOAuthClientConfig(
        clientId: String,
        clientSecret: String?
    ) throws {
        let secret = clientSecret?.trimmingCharacters(in: .whitespacesAndNewlines)
        let success = clientId.withCString { clientPtr in
            (secret ?? "").withCString { secretPtr in
                let secretPtrOrNil: UnsafePointer<CChar>? =
                    (secret?.isEmpty == false) ? secretPtr : nil
                return melon_pan_save_oauth_client_config(clientPtr, secretPtrOrNil) == 1
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "save_oauth_client_config failed")
        }
    }

    public struct LoginOutcome: Codable {
        public let account: String
        public let email: String
        public let displayName: String
        public let scope: String
        public let expiresAtUnix: UInt64
    }

    /// Wraps `melon_pan_run_login`. Blocks on the loopback callback,
    /// so callers must invoke this off the main thread (`Task.detached`).
    /// Returns the JSON-decoded LoginOutcome on success.
    public static func runLogin(
        credentialsPath: String,
        accountOverride: String?,
        narrowScope: Bool,
        port: UInt16
    ) throws -> LoginOutcome {
        let raw = credentialsPath.withCString { credsPtr in
            (accountOverride ?? "").withCString { acctPtr in
                let acctPtrOrNil: UnsafePointer<CChar>? =
                    (accountOverride == nil) ? nil : acctPtr
                return melon_pan_run_login(
                    credsPtr,
                    acctPtrOrNil,
                    narrowScope ? 1 : 0,
                    port
                )
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "run_login failed")
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                LoginOutcome.self,
                from: Data(json.utf8)
            )
        } catch {
            let bridgeError = RuntimeBridgeError.decode(
                "runLogin: \(error.localizedDescription); raw=\(json)"
            )
            throw bridgeError
        }
    }

    public static func runLoginWithSavedOAuthClient(
        accountOverride: String?,
        narrowScope: Bool,
        port: UInt16
    ) throws -> LoginOutcome {
        let raw = (accountOverride ?? "").withCString { acctPtr in
            let acctPtrOrNil: UnsafePointer<CChar>? =
                (accountOverride == nil) ? nil : acctPtr
            return melon_pan_run_login_with_saved_oauth_client(
                acctPtrOrNil,
                narrowScope ? 1 : 0,
                port
            )
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "run_login_with_saved_oauth_client failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(LoginOutcome.self, raw: raw, context: "runLoginWithSavedOAuthClient")
    }

    // MARK: - Tab restoration

    public struct RehydratedDocument: Codable {
        public let documentId: String
        public let revisionId: String
        public let title: String
        public let bodyEndIndex: UInt32
        public let plainText: String
    }

    public struct DocSummary: Codable, Sendable, Equatable {
        public let id: String
        public let title: String
        public let snippet: String
        public let updatedAt: Date?

        public init(id: String, title: String, snippet: String, updatedAt: Date?) {
            self.id = id
            self.title = title
            self.snippet = snippet
            self.updatedAt = updatedAt
        }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            title = try container.decode(String.self, forKey: .title)
            snippet = try container.decode(String.self, forKey: .snippet)
            let rawDate = try container.decodeIfPresent(String.self, forKey: .updatedAt)
            updatedAt = Self.decodeDate(rawDate)
        }

        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(title, forKey: .title)
            try container.encode(snippet, forKey: .snippet)
            try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
        }

        private enum CodingKeys: String, CodingKey {
            case id, title, snippet, updatedAt
        }

        private static func decodeDate(_ value: String?) -> Date? {
            guard let value, value.isEmpty == false, value != "unknown" else { return nil }
            if let date = ISO8601DateFormatter().date(from: value) {
                return date
            }
            if let seconds = TimeInterval(value) {
                return Date(timeIntervalSince1970: seconds)
            }
            return nil
        }
    }

    /// Wraps `melon_pan_rehydrate_document`. Returns nil when the doc
    /// has no `current.docs.json` (silently dropped by the caller — the
    /// windows.json restore loop skips missing entries).
    public static func rehydrateDocument(
        cacheRoot: String,
        documentId: String
    ) -> RehydratedDocument? {
        let raw = cacheRoot.withCString { rootPtr in
            documentId.withCString { docPtr in
                melon_pan_rehydrate_document(rootPtr, docPtr)
            }
        }
        guard let raw else { return nil }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        return try? JSONDecoder().decode(
            RehydratedDocument.self,
            from: Data(json.utf8)
        )
    }

    public static func enumerateCachedDocs(cacheRoot: String) throws -> [DocSummary] {
        let raw = cacheRoot.withCString { melon_pan_enumerate_cached_docs($0) }
        guard let raw else {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "enumerate_cached_docs failed"
            )
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode([DocSummary].self, from: Data(json.utf8))
        } catch {
            throw RuntimeBridgeError.decode("enumerateCachedDocs: \(error)")
        }
    }

    // MARK: - Conflict enumeration

    public struct DocPendingSummary: Codable {
        public let documentId: String
        public let pendingMutations: [String]
        public let prePushSnapshots: [String]

        public var isEmpty: Bool {
            pendingMutations.isEmpty && prePushSnapshots.isEmpty
        }
    }

    /// Wraps `melon_pan_list_cached_document_ids`.
    public static func listCachedDocumentIds(cacheRoot: String) throws -> [String] {
        let raw = cacheRoot.withCString { melon_pan_list_cached_document_ids($0) }
        guard let raw else {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "list_cached_document_ids failed"
            )
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                [String].self,
                from: Data(json.utf8)
            )
        } catch {
            throw RuntimeBridgeError.decode("listCachedDocumentIds: \(error)")
        }
    }

    /// Wraps `melon_pan_doc_pending_summary`.
    public static func docPendingSummary(
        cacheRoot: String,
        documentId: String
    ) throws -> DocPendingSummary {
        let raw = cacheRoot.withCString { rootPtr in
            documentId.withCString { docPtr in
                melon_pan_doc_pending_summary(rootPtr, docPtr)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "doc_pending_summary failed"
            )
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                DocPendingSummary.self,
                from: Data(json.utf8)
            )
        } catch {
            throw RuntimeBridgeError.decode("docPendingSummary: \(error)")
        }
    }

    public static func recentSyncEvents(
        cacheRoot: String,
        limit: UInt32
    ) throws -> [HistoryEvent] {
        let raw = cacheRoot.withCString { rootPtr in
            melon_pan_recent_sync_events(rootPtr, limit)
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "recent_sync_events failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON([HistoryEvent].self, raw: raw, context: "recentSyncEvents")
    }

    public static func clearJournal(cacheRoot: String, retainDays: UInt32) throws {
        let success = cacheRoot.withCString { rootPtr in
            melon_pan_clear_journal(rootPtr, retainDays) == 1
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "clear_journal failed")
        }
    }

    public static func listRevisionSnapshots(
        cacheRoot: String,
        documentId: String
    ) throws -> [SnapshotInfo] {
        let raw = cacheRoot.withCString { rootPtr in
            documentId.withCString { docPtr in
                melon_pan_list_revision_snapshots(rootPtr, docPtr)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "list_revision_snapshots failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON([SnapshotInfo].self, raw: raw, context: "listRevisionSnapshots")
    }

    public static func loadOpenHistory(configRoot: String) throws -> [OpenHistoryEntry] {
        let raw = configRoot.withCString { rootPtr in
            melon_pan_load_open_history(rootPtr)
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "load_open_history failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON([OpenHistoryEntry].self, raw: raw, context: "loadOpenHistory")
    }

    public static func recordOpenHistory(configRoot: String, entry: String) throws {
        let success = configRoot.withCString { rootPtr in
            entry.withCString { entryPtr in
                melon_pan_record_open_history(rootPtr, entryPtr) == 1
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "record_open_history failed")
        }
    }

    /// Wraps `melon_pan_restore_snapshot`. Throws on failure.
    public static func restoreSnapshot(
        cacheRoot: String,
        documentId: String,
        snapshotPath: String
    ) throws {
        let success = cacheRoot.withCString { rootPtr in
            documentId.withCString { docPtr in
                snapshotPath.withCString { snapPtr in
                    melon_pan_restore_snapshot(rootPtr, docPtr, snapPtr) == 1
                }
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "restore_snapshot failed")
        }
    }

    // MARK: - Updater

    public struct UpdateStatus: Codable {
        public let current: String
        public let latest: String
        public let releaseUrl: String
        public let hasUpdate: Bool
    }

    /// Wraps `melon_pan_check_for_updates`. `repo` may be nil to use
    /// the runtime's default. Blocking — call from Task.detached.
    public static func checkForUpdates(
        repo: String? = nil,
        currentVersion: String
    ) throws -> UpdateStatus {
        let raw = currentVersion.withCString { versionPtr in
            (repo ?? "").withCString { repoPtr in
                let repoOrNil: UnsafePointer<CChar>? =
                    (repo == nil) ? nil : repoPtr
                return melon_pan_check_for_updates(repoOrNil, versionPtr)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "check_for_updates failed"
            )
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                UpdateStatus.self,
                from: Data(json.utf8)
            )
        } catch {
            throw RuntimeBridgeError.decode(
                "checkForUpdates: \(error.localizedDescription)"
            )
        }
    }

    public struct DriftDocument: Codable, Hashable {
        public let documentId: String
        public let title: String
    }

    public static func auditDriftCheck(cacheRoot: String) throws -> [DriftDocument] {
        let raw = cacheRoot.withCString { melon_pan_audit_drift_check($0) }
        guard let raw else {
            throw RuntimeBridgeError.ffi(
                lastError() ?? "audit_drift_check failed"
            )
        }
        defer { melon_pan_string_free(raw) }
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(
                [DriftDocument].self,
                from: Data(json.utf8)
            )
        } catch {
            throw RuntimeBridgeError.decode("auditDriftCheck: \(error)")
        }
    }

    public static func tokenLookup(account: String) -> String? {
        let raw = account.withCString { acct in
            melon_pan_token_lookup(acct)
        }
        guard let raw else { return nil }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    // MARK: - System

    public struct DiagnosticSnapshot: Codable {
        public let cacheRoot: String
        public let totalSnapshotBytes: UInt64
        public let docCount: Int
        public let snapshotCount: Int
        public let driveTreeMtimeUnix: UInt64?
        public let runtimeSharedVersion: String
        public let coreVersion: String
    }

    public struct AuditStatusReport: Codable {
        public let mdHash: String
        public let docsHash: String
        public let mdFromDocsHash: String
        public let docsFromMdHash: String
    }

    public struct KeychainProbeReport: Codable {
        public let state: String
        public let itemCount: UInt32
        public let service: String
    }

    public struct RuntimeVersions: Codable {
        public let coreVersion: String
        public let runtimeSharedVersion: String
        public let commitSHA: String
        public let buildTimestamp: String
    }

    public struct TokenMetadata: Codable {
        public let scope: String
        public let expiresAtUnix: UInt64
        public let hasRefreshToken: Bool
    }

    public static func diagnosticSnapshot(cacheRoot: String) throws -> DiagnosticSnapshot {
        let raw = cacheRoot.withCString { root in
            melon_pan_diagnostic_snapshot(root)
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "diagnostic_snapshot failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(DiagnosticSnapshot.self, raw: raw, context: "diagnosticSnapshot")
    }

    public static func auditStatus(
        cacheRoot: String,
        documentId: String
    ) throws -> AuditStatusReport {
        let raw = cacheRoot.withCString { root in
            documentId.withCString { doc in
                melon_pan_audit_status(root, doc)
            }
        }
        guard let raw else {
            throw RuntimeBridgeError.ffi(lastError() ?? "audit_status failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(AuditStatusReport.self, raw: raw, context: "auditStatus")
    }

    public static func keychainProbe() throws -> KeychainProbeReport {
        guard let raw = melon_pan_keychain_probe() else {
            throw RuntimeBridgeError.ffi(lastError() ?? "keychain_probe failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(KeychainProbeReport.self, raw: raw, context: "keychainProbe")
    }

    public static func runtimeVersions() throws -> RuntimeVersions {
        guard let raw = melon_pan_runtime_versions() else {
            throw RuntimeBridgeError.ffi(lastError() ?? "runtime_versions failed")
        }
        defer { melon_pan_string_free(raw) }
        return try decodeJSON(RuntimeVersions.self, raw: raw, context: "runtimeVersions")
    }

    public static func tokenMetadata(account: String) -> TokenMetadata? {
        let raw = account.withCString { acct in
            melon_pan_token_metadata(acct)
        }
        guard let raw else { return nil }
        defer { melon_pan_string_free(raw) }
        return try? decodeJSON(TokenMetadata.self, raw: raw, context: "tokenMetadata")
    }

    public static func forceFullResync(cacheRoot: String, accessToken: String) throws {
        let success = cacheRoot.withCString { root in
            accessToken.withCString { token in
                melon_pan_force_full_resync(root, token) == 1
            }
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "force_full_resync failed")
        }
    }

    public static func clearCachedDriveData(cacheRoot: String) throws {
        let success = cacheRoot.withCString { root in
            melon_pan_clear_cached_drive_data(root) == 1
        }
        if !success {
            throw RuntimeBridgeError.ffi(lastError() ?? "clear_cached_drive_data failed")
        }
    }

    @discardableResult
    public static func openURL(_ url: String) -> Bool {
        url.withCString { ptr in melon_pan_open_url(ptr) == 1 }
    }

    public static func installSyncErrorCallback(
        _ handler: @escaping (String, String) -> Void
    ) {
        SyncErrorCallbackStore.handler = handler
        melon_pan_set_sync_error_callback(syncErrorCallback)
    }

    // MARK: - Errors

    /// Reads + clears the thread-local error message. Returns nil
    /// when no error is set.
    public static func lastError() -> String? {
        guard let raw = melon_pan_last_error() else { return nil }
        defer { melon_pan_string_free(raw) }
        return String(cString: raw)
    }

    private static func decodeJSON<T: Decodable>(
        _ type: T.Type,
        raw: UnsafeMutablePointer<CChar>,
        context: String
    ) throws -> T {
        let json = String(cString: raw)
        do {
            return try JSONDecoder().decode(type, from: Data(json.utf8))
        } catch {
            throw RuntimeBridgeError.decode(
                "\(context): \(error.localizedDescription); raw=\(json)"
            )
        }
    }

    private static func decodeTemplateJSON<T: Decodable>(
        _ type: T.Type,
        raw: UnsafeMutablePointer<CChar>,
        context: String
    ) throws -> T {
        let json = String(cString: raw)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(type, from: Data(json.utf8))
        } catch {
            throw RuntimeBridgeError.decode(
                "\(context): \(error.localizedDescription); raw=\(json)"
            )
        }
    }

    private static func encodeImportOptions(_ options: ImportOptions) throws -> String {
        do {
            let data = try JSONEncoder().encode(options)
            return String(decoding: data, as: UTF8.self)
        } catch {
            throw RuntimeBridgeError.decode("ImportOptions: \(error.localizedDescription)")
        }
    }
}

private enum SyncErrorCallbackStore {
    static var handler: ((String, String) -> Void)?
}

private let syncErrorCallback: @convention(c) (
    UnsafePointer<CChar>?,
    UnsafePointer<CChar>?
) -> Void = { documentIdPtr, messagePtr in
    guard let documentIdPtr, let messagePtr else { return }
    let documentId = String(cString: documentIdPtr)
    let message = String(cString: messagePtr)
    SyncErrorCallbackStore.handler?(documentId, message)
}
