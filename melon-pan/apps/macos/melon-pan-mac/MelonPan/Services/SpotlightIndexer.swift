@preconcurrency import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

protocol SpotlightIndexing {
    func deleteSearchableItems(withDomainIdentifiers domainIdentifiers: [String]) async throws
    func deleteSearchableItems(withIdentifiers identifiers: [String]) async throws
    func indexSearchableItems(_ items: [CSSearchableItem]) async throws
}

extension CSSearchableIndex: SpotlightIndexing {}

actor SpotlightIndexer {
    static let shared = SpotlightIndexer()
    static let domain = "com.gongahkia.MelonPan.documents"
    static let urlScheme = "melonpan://document/"
    static let plainTextContentType = UTType.plainText

    static let indexingEnabledKey = "MelonPan.spotlightIndexingEnabled"
    static let lastFullReindexKey = "MelonPan.spotlightLastFullReindexAt"
    static let lastIndexedDocCountKey = "MelonPan.spotlightLastIndexedDocCount"

    private let index: SpotlightIndexing
    private var didPrime = false
    private var fingerprints: [String: Int] = [:]

    init(index: SpotlightIndexing = CSSearchableIndex.default()) {
        self.index = index
    }

    func reindexAll(cacheRoot: String) async {
        guard isEnabled() else { return }
        let summaries = (try? RuntimeBridge.enumerateCachedDocs(cacheRoot: cacheRoot)) ?? []
        if shouldSkipFullReindex(docCount: summaries.count) {
            didPrime = true
            fingerprints = Dictionary(uniqueKeysWithValues:
                summaries.map { ($0.id, Self.fingerprint($0)) })
            return
        }
        do {
            try await index.deleteSearchableItems(withDomainIdentifiers: [Self.domain])
            if summaries.isEmpty == false {
                try await index.indexSearchableItems(summaries.map(item))
            }
            didPrime = true
            fingerprints = Dictionary(uniqueKeysWithValues:
                summaries.map { ($0.id, Self.fingerprint($0)) })
            recordFullReindex(docCount: summaries.count)
        } catch {
            didPrime = false
        }
    }

    func update(documentId: String, cacheRoot: String) async {
        guard isEnabled() else { return }
        guard let rehydrated = RuntimeBridge.rehydrateDocument(
            cacheRoot: cacheRoot,
            documentId: documentId
        ) else { return }
        let summary = RuntimeBridge.DocSummary(
            id: rehydrated.documentId,
            title: rehydrated.title,
            snippet: rehydrated.plainText,
            updatedAt: nil
        )
        let fp = Self.fingerprint(summary)
        if fingerprints[summary.id] == fp { return }
        do {
            try await index.indexSearchableItems([item(summary)])
            fingerprints[summary.id] = fp
            if didPrime == false { didPrime = true }
        } catch {}
    }

    func delete(documentId: String) async {
        let uid = Self.urlScheme + documentId
        try? await index.deleteSearchableItems(withIdentifiers: [uid])
        fingerprints.removeValue(forKey: documentId)
    }

    func removeAll() async {
        try? await index.deleteSearchableItems(withDomainIdentifiers: [Self.domain])
        didPrime = false
        fingerprints = [:]
        UserDefaults.standard.removeObject(forKey: Self.lastFullReindexKey)
        UserDefaults.standard.removeObject(forKey: Self.lastIndexedDocCountKey)
    }

    nonisolated func item(_ s: RuntimeBridge.DocSummary) -> CSSearchableItem {
        let attrs = CSSearchableItemAttributeSet(contentType: Self.plainTextContentType)
        attrs.title = s.title
        attrs.displayName = s.title
        attrs.kind = "Google Docs document"
        let stripped = MarkdownStripper.strip(s.snippet)
        attrs.contentDescription = String(stripped.prefix(250))
        attrs.textContent = String(stripped.prefix(4000))
        attrs.keywords = ["melon pan", "google docs"] + MarkdownStripper.keywords(s.snippet)
        attrs.contentURL = URL(string: Self.urlScheme + s.id)
        attrs.contentModificationDate = s.updatedAt
        attrs.metadataModificationDate = s.updatedAt
        attrs.lastUsedDate = s.updatedAt
        return CSSearchableItem(
            uniqueIdentifier: Self.urlScheme + s.id,
            domainIdentifier: Self.domain,
            attributeSet: attrs
        )
    }

    nonisolated private static func fingerprint(_ s: RuntimeBridge.DocSummary) -> Int {
        var hasher = Hasher()
        hasher.combine(s.id)
        hasher.combine(s.title)
        hasher.combine(s.snippet)
        hasher.combine(s.updatedAt)
        return hasher.finalize()
    }

    private func isEnabled() -> Bool {
        UserDefaults.standard.object(forKey: Self.indexingEnabledKey) as? Bool ?? true
    }

    private func shouldSkipFullReindex(docCount: Int) -> Bool {
        guard let last = UserDefaults.standard.object(forKey: Self.lastFullReindexKey) as? Date else {
            return false
        }
        let lastCount = UserDefaults.standard.integer(forKey: Self.lastIndexedDocCountKey)
        return lastCount >= docCount && Date().timeIntervalSince(last) < 24 * 60 * 60
    }

    private func recordFullReindex(docCount: Int) {
        UserDefaults.standard.set(Date(), forKey: Self.lastFullReindexKey)
        UserDefaults.standard.set(docCount, forKey: Self.lastIndexedDocCountKey)
    }
}

enum SpotlightIdentifier: Equatable {
    case document(String)

    init?(uniqueIdentifier: String) {
        guard uniqueIdentifier.hasPrefix(SpotlightIndexer.urlScheme) else { return nil }
        let id = String(uniqueIdentifier.dropFirst(SpotlightIndexer.urlScheme.count))
        guard id.isEmpty == false else { return nil }
        self = .document(id)
    }
}

enum MarkdownStripper {
    private static let fencedCode = try! NSRegularExpression(
        pattern: "```[\\s\\S]*?```",
        options: []
    )
    private static let inlineCode = try! NSRegularExpression(
        pattern: "`[^`]*`",
        options: []
    )
    private static let headingMarker = try! NSRegularExpression(
        pattern: "^#{1,6}\\s+",
        options: [.anchorsMatchLines]
    )
    private static let setextUnderline = try! NSRegularExpression(
        pattern: "^[=-]{2,}\\s*$",
        options: [.anchorsMatchLines]
    )
    private static let emphasis = try! NSRegularExpression(
        pattern: "(\\*\\*|__|\\*|_)",
        options: []
    )
    private static let linkSyntax = try! NSRegularExpression(
        pattern: "\\[([^\\]]+)\\]\\([^\\)]+\\)",
        options: []
    )
    private static let imageSyntax = try! NSRegularExpression(
        pattern: "!\\[[^\\]]*\\]\\([^\\)]+\\)",
        options: []
    )
    private static let htmlTag = try! NSRegularExpression(
        pattern: "<[^>]+>",
        options: []
    )
    private static let multiSpace = try! NSRegularExpression(
        pattern: "\\s+",
        options: []
    )
    private static let hashTag = try! NSRegularExpression(
        pattern: "(?:^|\\s)#([A-Za-z][A-Za-z0-9_-]+)",
        options: []
    )
    private static let headingLine = try! NSRegularExpression(
        pattern: "^#{1,6}\\s+(.+)$",
        options: [.anchorsMatchLines]
    )
    private static let setextHeading = try! NSRegularExpression(
        pattern: "^([^\\n]+)\\n[=-]{2,}\\s*$",
        options: [.anchorsMatchLines]
    )

    static func strip(_ md: String) -> String {
        var s = md as NSString
        let range = { NSRange(location: 0, length: s.length) }
        s = fencedCode.stringByReplacingMatches(in: s as String, range: range(), withTemplate: " ") as NSString
        s = imageSyntax.stringByReplacingMatches(in: s as String, range: range(), withTemplate: " ") as NSString
        s = linkSyntax.stringByReplacingMatches(in: s as String, range: range(), withTemplate: "$1") as NSString
        s = inlineCode.stringByReplacingMatches(in: s as String, range: range(), withTemplate: " ") as NSString
        s = headingMarker.stringByReplacingMatches(in: s as String, range: range(), withTemplate: "") as NSString
        s = setextUnderline.stringByReplacingMatches(in: s as String, range: range(), withTemplate: " ") as NSString
        s = emphasis.stringByReplacingMatches(in: s as String, range: range(), withTemplate: "") as NSString
        s = htmlTag.stringByReplacingMatches(in: s as String, range: range(), withTemplate: " ") as NSString
        s = multiSpace.stringByReplacingMatches(in: s as String, range: range(), withTemplate: " ") as NSString
        return (s as String).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func keywords(_ md: String) -> [String] {
        let nsmd = md as NSString
        var out: Set<String> = []
        headingLine.enumerateMatches(in: md, range: NSRange(location: 0, length: nsmd.length)) { match, _, _ in
            guard let match, match.numberOfRanges > 1 else { return }
            let heading = nsmd.substring(with: match.range(at: 1))
                .trimmingCharacters(in: .whitespaces)
            if heading.isEmpty == false { out.insert(heading.lowercased()) }
        }
        setextHeading.enumerateMatches(in: md, range: NSRange(location: 0, length: nsmd.length)) { match, _, _ in
            guard let match, match.numberOfRanges > 1 else { return }
            let heading = nsmd.substring(with: match.range(at: 1))
                .trimmingCharacters(in: .whitespaces)
            if heading.isEmpty == false { out.insert(heading.lowercased()) }
        }
        hashTag.enumerateMatches(in: md, range: NSRange(location: 0, length: nsmd.length)) { match, _, _ in
            guard let match, match.numberOfRanges > 1 else { return }
            out.insert(nsmd.substring(with: match.range(at: 1)).lowercased())
        }
        return Array(out.prefix(32))
    }
}
