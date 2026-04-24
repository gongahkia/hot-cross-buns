import AppKit
import Foundation
import Observation
import Sparkle

@MainActor
@Observable
final class UpdaterController: NSObject, SPUUpdaterDelegate {
    struct ToastState: Equatable {
        let title: String
        let message: String
        let isWarning: Bool
    }

    struct AvailableRelease: Equatable {
        let version: String
        let tagName: String
        let htmlURL: URL
        let downloadURL: URL?
        let publishedAt: Date?
    }

    enum CheckTrigger {
        case manual
        case automatic
    }

    private enum DefaultsKey {
        static let autoCheckEnabled = "hcb.updates.autoCheckEnabled"
        static let lastCheckAt = "hcb.updates.lastCheckAt"
    }

    private struct GitHubAsset: Decodable {
        let name: String
        let browserDownloadURL: URL

        enum CodingKeys: String, CodingKey {
            case name
            case browserDownloadURL = "browser_download_url"
        }
    }

    private struct GitHubRelease: Decodable {
        let tagName: String
        let htmlURL: URL
        let publishedAt: Date?
        let assets: [GitHubAsset]

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case htmlURL = "html_url"
            case publishedAt = "published_at"
            case assets
        }
    }

    private struct ReleaseVersion: Comparable {
        let components: [Int]

        init(_ rawValue: String) {
            components = rawValue
                .split(whereSeparator: { $0.isNumber == false })
                .compactMap { Int($0) }
        }

        var isKnown: Bool {
            components.isEmpty == false
        }

        static func < (lhs: ReleaseVersion, rhs: ReleaseVersion) -> Bool {
            let maxCount = max(lhs.components.count, rhs.components.count)
            for index in 0..<maxCount {
                let left = lhs.components.indices.contains(index) ? lhs.components[index] : 0
                let right = rhs.components.indices.contains(index) ? rhs.components[index] : 0
                if left != right {
                    return left < right
                }
            }
            return false
        }
    }

    private let bundle: Bundle
    private let userDefaults: UserDefaults
    private let urlSession: URLSession
    private let openURL: (URL) -> Bool
    private let now: () -> Date
    private var controller: SPUStandardUpdaterController?
    private(set) var toastState: ToastState?
    private(set) var availableRelease: AvailableRelease?
    private(set) var isChecking = false

    private let githubLatestReleaseURL = URL(string: "https://api.github.com/repos/gongahkia/hot-cross-buns/releases/latest")!
    private let githubReleasesPageURL = URL(string: "https://github.com/gongahkia/hot-cross-buns/releases")!

    init(
        bundle: Bundle = .main,
        userDefaults: UserDefaults = .standard,
        urlSession: URLSession = .shared,
        openURL: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) },
        now: @escaping () -> Date = Date.init
    ) {
        self.bundle = bundle
        self.userDefaults = userDefaults
        self.urlSession = urlSession
        self.openURL = openURL
        self.now = now
        super.init()
    }

    var usesSparkle: Bool {
        let feedURL = (bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String) ?? ""
        let publicKey = (bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String) ?? ""
        return feedURL.isEmpty == false && publicKey.isEmpty == false
    }

    var isConfigured: Bool {
        usesSparkle
    }

    var updateSourceLabel: String {
        usesSparkle ? "Built-in feed" : "GitHub Releases"
    }

    var automaticCheckLabel: String {
        usesSparkle ? "Check for updates automatically" : "Check GitHub releases automatically"
    }

    var automaticallyChecksForUpdates: Bool {
        get {
            if usesSparkle {
                return updaterController(startingUpdater: false)?.updater.automaticallyChecksForUpdates ?? false
            }
            if userDefaults.object(forKey: DefaultsKey.autoCheckEnabled) == nil {
                return true
            }
            return userDefaults.bool(forKey: DefaultsKey.autoCheckEnabled)
        }
        set {
            if usesSparkle {
                updaterController(startingUpdater: true)?.updater.automaticallyChecksForUpdates = newValue
            } else {
                userDefaults.set(newValue, forKey: DefaultsKey.autoCheckEnabled)
            }
        }
    }

    var lastUpdateCheckDate: Date? {
        if usesSparkle {
            return updaterController(startingUpdater: false)?.updater.lastUpdateCheckDate
        }
        return userDefaults.object(forKey: DefaultsKey.lastCheckAt) as? Date
    }

    func checkForUpdates() {
        Task {
            await checkForUpdatesNow(trigger: .manual)
        }
    }

    func checkForUpdatesNow(trigger: CheckTrigger) async {
        if usesSparkle {
            startSparkleIfNeeded(trigger: trigger)
            return
        }

        guard isChecking == false else { return }
        isChecking = true
        defer { isChecking = false }

        do {
            let request = githubLatestReleaseRequest()
            let (data, response) = try await urlSession.data(for: request)
            try validateGitHubResponse(response, data: data)
            let release = try decodeGitHubRelease(from: data)

            let checkedAt = now()
            userDefaults.set(checkedAt, forKey: DefaultsKey.lastCheckAt)

            if isNewerThanCurrentVersion(release.tagName) {
                availableRelease = makeAvailableRelease(from: release)
                if trigger == .manual || trigger == .automatic {
                    toastState = ToastState(
                        title: "Update available",
                        message: "Hot Cross Buns \(availableRelease?.version ?? release.tagName) is available from GitHub Releases.",
                        isWarning: false
                    )
                }
            } else {
                availableRelease = nil
                if trigger == .manual {
                    toastState = ToastState(
                        title: "You're on the latest version",
                        message: "Hot Cross Buns didn't find anything newer on GitHub Releases.",
                        isWarning: false
                    )
                }
            }
        } catch {
            if trigger == .manual {
                toastState = ToastState(
                    title: "Couldn't reach GitHub Releases",
                    message: error.localizedDescription,
                    isWarning: true
                )
            }
        }
    }

    func performAutomaticCheckIfNeeded() async {
        if usesSparkle {
            _ = updaterController(startingUpdater: true)
            return
        }

        guard automaticallyChecksForUpdates else { return }
        if let lastUpdateCheckDate,
           now().timeIntervalSince(lastUpdateCheckDate) < 60 * 60 * 24 {
            return
        }
        await checkForUpdatesNow(trigger: .automatic)
    }

    func openAvailableReleaseDownload() {
        let target = availableRelease?.downloadURL ?? availableRelease?.htmlURL ?? githubReleasesPageURL
        guard openURL(target) else {
            toastState = ToastState(
                title: "Couldn't open release page",
                message: target.absoluteString,
                isWarning: true
            )
            return
        }
    }

    func openReleasesPage() {
        guard openURL(githubReleasesPageURL) else {
            toastState = ToastState(
                title: "Couldn't open release page",
                message: githubReleasesPageURL.absoluteString,
                isWarning: true
            )
            return
        }
    }

    func clearToast() {
        toastState = nil
    }

    private func startSparkleIfNeeded(trigger: CheckTrigger) {
        guard let controller = updaterController(startingUpdater: true) else {
            if trigger == .manual {
                toastState = ToastState(
                    title: "Updates unavailable",
                    message: "Install a configured release build or use the GitHub Releases page.",
                    isWarning: true
                )
            }
            return
        }
        if trigger == .manual {
            controller.checkForUpdates(nil)
        }
    }

    private func updaterController(startingUpdater: Bool) -> SPUStandardUpdaterController? {
        guard usesSparkle else {
            return nil
        }

        if let controller {
            return controller
        }

        let created = SPUStandardUpdaterController(
            startingUpdater: startingUpdater,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        controller = created
        return created
    }

    private func githubLatestReleaseRequest() -> URLRequest {
        var request = URLRequest(url: githubLatestReleaseURL)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("HotCrossBunsMac/\(currentVersionString)", forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15
        return request
    }

    private func validateGitHubResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw UpdateCheckError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw UpdateCheckError.httpStatus(code: http.statusCode, message: message)
        }
    }

    private func decodeGitHubRelease(from data: Data) throws -> GitHubRelease {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(GitHubRelease.self, from: data)
    }

    private func makeAvailableRelease(from release: GitHubRelease) -> AvailableRelease {
        let download = preferredDMGAsset(in: release.assets)?.browserDownloadURL
        return AvailableRelease(
            version: normalizedVersionString(release.tagName),
            tagName: release.tagName,
            htmlURL: release.htmlURL,
            downloadURL: download,
            publishedAt: release.publishedAt
        )
    }

    private func preferredDMGAsset(in assets: [GitHubAsset]) -> GitHubAsset? {
        if let exact = assets.first(where: { $0.name == "HotCrossBuns-macOS.dmg" }) {
            return exact
        }
        return assets.first(where: { $0.name.hasSuffix(".dmg") })
    }

    private var currentVersionString: String {
        (bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
    }

    private func normalizedVersionString(_ rawValue: String) -> String {
        rawValue.replacingOccurrences(of: #"^[^0-9]+"#, with: "", options: .regularExpression)
    }

    private func isNewerThanCurrentVersion(_ releaseTag: String) -> Bool {
        let current = ReleaseVersion(currentVersionString)
        let remote = ReleaseVersion(normalizedVersionString(releaseTag))
        if current.isKnown && remote.isKnown {
            return current < remote
        }
        return normalizedVersionString(releaseTag) != currentVersionString
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        toastState = ToastState(
            title: "You're on the latest version",
            message: "Hot Cross Buns didn't find anything newer to install.",
            isWarning: false
        )
    }

    func updater(_ updater: SPUUpdater, didAbortWithError error: any Error) {
        toastState = ToastState(
            title: "Couldn't reach update server",
            message: error.localizedDescription,
            isWarning: true
        )
    }
}

private enum UpdateCheckError: LocalizedError {
    case invalidResponse
    case httpStatus(code: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "GitHub Releases returned an invalid response."
        case .httpStatus(let code, let message):
            if let message, message.isEmpty == false {
                return "GitHub Releases responded with \(code): \(message)"
            }
            return "GitHub Releases responded with HTTP \(code)."
        }
    }
}
