import XCTest
@testable import MelonPan

@MainActor
final class TemplatesTests: XCTestCase {
    func testViewModelLoadsSavesSelectsAndDeletes() {
        let id = UUID()
        let mock = MockTemplatesBridge()
        mock.templates = [
            TemplateInfo(
                id: id,
                name: "Weekly",
                path: "/tmp/templates/Weekly.md",
                updatedAt: Date(timeIntervalSince1970: 1)
            )
        ]
        let vm = TemplatesViewModel()
        vm.bridge = mock

        vm.load(cacheRoot: "/tmp/cache")
        XCTAssertEqual(vm.templates.count, 1)

        let template = MarkdownTemplate(
            id: id,
            name: "Weekly",
            body: "# Weekly",
            createdAt: Date(timeIntervalSince1970: 1),
            updatedAt: Date(timeIntervalSince1970: 2)
        )
        vm.save(template, cacheRoot: "/tmp/cache")
        XCTAssertEqual(mock.saved?.id, id)
        XCTAssertEqual(vm.selectedId, id)

        vm.delete(vm.templates[0], cacheRoot: "/tmp/cache")
        XCTAssertEqual(mock.deleted, id)
    }

    func testExpandUsesLoadedTemplateAndActiveAccount() throws {
        let id = UUID()
        let mock = MockTemplatesBridge()
        mock.loaded = MarkdownTemplate(
            id: id,
            name: "Plan",
            body: "# {{title}}\n{{author}}",
            createdAt: Date(timeIntervalSince1970: 1),
            updatedAt: Date(timeIntervalSince1970: 2)
        )
        mock.expanded = "# Plan\nuser@example.com"
        let vm = TemplatesViewModel()
        vm.bridge = mock

        let session = AppSession()
        session.cacheRoot = "/tmp/cache"
        session.activeAccount = "user@example.com"
        let body = try vm.expand(
            TemplateInfo(
                id: id,
                name: "Plan",
                path: "/tmp/templates/Plan.md",
                updatedAt: Date()
            ),
            session: session
        )

        XCTAssertEqual(body, "# Plan\nuser@example.com")
        XCTAssertEqual(mock.expandAuthor, "user@example.com")
    }
}

private final class MockTemplatesBridge: TemplatesRuntimeBridging, @unchecked Sendable {
    var templates: [TemplateInfo] = []
    var saved: MarkdownTemplate?
    var deleted: UUID?
    var loaded: MarkdownTemplate?
    var expanded = ""
    var expandAuthor = ""

    func templatesList(cacheRoot: String) throws -> [TemplateInfo] {
        templates
    }

    func templateSave(cacheRoot: String, template: MarkdownTemplate) throws {
        saved = template
    }

    func templateDelete(cacheRoot: String, id: UUID) throws {
        deleted = id
    }

    func templateLoad(cacheRoot: String, id: UUID) throws -> MarkdownTemplate {
        loaded ?? MarkdownTemplate(id: id, name: "Untitled", body: "")
    }

    func templateExpand(body: String, title: String, author: String) throws -> String {
        expandAuthor = author
        return expanded
    }
}
