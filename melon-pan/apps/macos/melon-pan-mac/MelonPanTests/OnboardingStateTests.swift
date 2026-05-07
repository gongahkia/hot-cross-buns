import XCTest
@testable import MelonPan

@MainActor
final class OnboardingStateTests: XCTestCase {
    func testDefaultIsResumableAtWelcome() {
        let state = OnboardingState()

        XCTAssertEqual(state.lastStep, .welcome)
        XCTAssertFalse(state.isComplete)
    }

    func testRoundTripPersistence() throws {
        let root = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        var state = OnboardingState()
        state.lastStep = .scope
        state.welcomeAcknowledged = true
        state.oauthClient = .init(
            clientId: "1234-abc.apps.googleusercontent.com",
            hasSecret: false
        )

        OnboardingStateStore.save(state, cacheRoot: root.path)

        XCTAssertEqual(OnboardingStateStore.load(cacheRoot: root.path), state)
    }

    func testCanAdvanceGatedOnRequiredFields() throws {
        let root = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let vm = OnboardingViewModel(cacheRoot: root.path)

        XCTAssertFalse(vm.canAdvance(from: .welcome))
        vm.update { $0.welcomeAcknowledged = true }
        XCTAssertTrue(vm.canAdvance(from: .welcome))
    }

    func testResumeAtLastStep() throws {
        let root = try makeTemporaryCacheRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        var seed = OnboardingState()
        seed.lastStep = .cacheRoot
        OnboardingStateStore.save(seed, cacheRoot: root.path)

        XCTAssertEqual(OnboardingViewModel(cacheRoot: root.path).currentStep, .cacheRoot)
    }

    func testOAuthClientIdValidation() {
        XCTAssertTrue(isWellFormedDesktopClientId("1234567890-abc_DEF.apps.googleusercontent.com"))
        XCTAssertFalse(isWellFormedDesktopClientId("abc.apps.googleusercontent.com"))
        XCTAssertFalse(isWellFormedDesktopClientId("1234567890-abc.example.com"))
    }

    private func makeTemporaryCacheRoot() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("melon-pan-onboarding-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
