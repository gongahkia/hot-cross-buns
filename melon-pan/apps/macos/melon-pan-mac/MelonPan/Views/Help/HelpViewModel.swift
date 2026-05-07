import Foundation

@MainActor
final class HelpViewModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var bodies: [String: AttributedString] = [:]
    @Published private(set) var loadFailures: Set<String> = []

    func preload() async {
        for category in HelpCategory.all {
            load(category)
        }
    }

    func body(for category: HelpCategory) -> AttributedString {
        if let cached = bodies[category.id] {
            return cached
        }
        load(category)
        return bodies[category.id] ?? AttributedString("(Help text for \"\(category.title)\" failed to load.)")
    }

    func searchHits() -> [HelpSearchHit] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return [] }

        var hits: [HelpSearchHit] = []
        for category in HelpCategory.all {
            let bodyText = String(body(for: category).characters)
            if category.title.localizedCaseInsensitiveContains(normalized) || bodyText.localizedCaseInsensitiveContains(normalized) {
                hits.append(HelpSearchHit(category: category, snippet: snippet(bodyText, query: normalized)))
            }

            for entry in category.inlineShortcuts where ShortcutTable.matches(entry, highlight: normalized) {
                hits.append(HelpSearchHit(category: category, snippet: "\(entry.chord) - \(entry.command)"))
            }
        }
        return hits
    }

    private func load(_ category: HelpCategory) {
        guard bodies[category.id] == nil else { return }
        guard let url = Bundle.main.url(
            forResource: category.markdownAsset,
            withExtension: "md",
            subdirectory: "help"
        ),
              let raw = try? String(contentsOf: url, encoding: .utf8),
              let attributed = try? AttributedString(
                markdown: raw,
                options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
              )
        else {
            loadFailures.insert(category.id)
            return
        }
        bodies[category.id] = attributed
        loadFailures.remove(category.id)
    }

    private func snippet(_ body: String, query: String) -> String {
        guard let range = body.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else {
            return body.prefix(140).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let lower = body.index(range.lowerBound, offsetBy: -60, limitedBy: body.startIndex) ?? body.startIndex
        let upper = body.index(range.upperBound, offsetBy: 80, limitedBy: body.endIndex) ?? body.endIndex
        let prefix = lower == body.startIndex ? "" : "..."
        let suffix = upper == body.endIndex ? "" : "..."
        return prefix + body[lower..<upper].trimmingCharacters(in: .whitespacesAndNewlines) + suffix
    }
}
