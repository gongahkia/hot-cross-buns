import XCTest

final class HelpLocalizationTests: XCTestCase {
    func testHelpCopyUsesLocalizedLookups() throws {
        let source = try String(contentsOf: repoRoot.appending(path: "apps/apple/HotCrossBuns/Features/Help/HelpView.swift"))

        XCTAssertNil(source.range(of: #"HelpSectionData\(\s*title:\s*""#, options: .regularExpression))
        XCTAssertNil(source.range(of: #"\.init\(title:\s*""#, options: .regularExpression))
        XCTAssertNil(source.range(of: #"detail:\s*""#, options: .regularExpression))
        XCTAssertNil(source.range(of: #"ContentUnavailableView\(\s*""#, options: .regularExpression))
    }

    func testHelpLocalizedKeysExistForSingaporeLanguages() throws {
        let catalogURL = repoRoot.appending(path: "apps/apple/Resources/Localizable.xcstrings")
        let data = try Data(contentsOf: catalogURL)
        let catalog = try JSONDecoder().decode(StringCatalog.self, from: data)
        let expectedLanguages: Set<String> = ["en", "zh-Hans", "ms", "ta"]

        let sourceURLs = [
            "apps/apple/HotCrossBuns/Features/Help/HelpView.swift",
            "apps/apple/HotCrossBuns/Features/QuickAdd/NaturalLanguageTaskParser.swift",
            "apps/apple/HotCrossBuns/Features/Calendar/NaturalLanguageEventParser.swift",
            "apps/apple/HotCrossBuns/App/HCBChord.swift",
            "apps/apple/HotCrossBuns/App/HCBDeepLinkRouter.swift"
        ].map { repoRoot.appending(path: $0) }

        let keys = try sourceURLs.reduce(into: Set<String>()) { partial, url in
            let source = try String(contentsOf: url)
            partial.formUnion(Self.localizedKeys(in: source))
        }

        for key in keys {
            let entry = try XCTUnwrap(catalog.strings[key], "Missing catalog key: \(key)")
            let languages = Set(entry.localizations.keys)
            XCTAssertTrue(expectedLanguages.isSubset(of: languages), "Missing localization for \(key): \(expectedLanguages.subtracting(languages))")
        }
    }

    private static func localizedKeys(in source: String) -> Set<String> {
        var keys = Set<String>()
        for pattern in [
            #"hcbHelpString\("((?:\\.|[^"\\])*)"\)"#,
            #"String\(localized:\s*"((?:\\.|[^"\\])*)"\)"#
        ] {
            let regex = try! NSRegularExpression(pattern: pattern)
            let range = NSRange(source.startIndex..<source.endIndex, in: source)
            for match in regex.matches(in: source, range: range) {
                guard let keyRange = Range(match.range(at: 1), in: source) else { continue }
                var key = String(source[keyRange])
                    .replacingOccurrences(of: #"\""#, with: #"""#)
                    .replacingOccurrences(of: #"\n"#, with: "\n")
                key = key.replacingOccurrences(of: #"\(entry.title)"#, with: "%@")
                keys.insert(key)
            }
        }
        keys.insert("Task quick-add: %@")
        keys.insert("Event quick-add: %@")
        return keys
    }

    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}

private struct StringCatalog: Decodable {
    var strings: [String: StringCatalogEntry]
}

private struct StringCatalogEntry: Decodable {
    var localizations: [String: StringCatalogLocalization]
}

private struct StringCatalogLocalization: Decodable {}
