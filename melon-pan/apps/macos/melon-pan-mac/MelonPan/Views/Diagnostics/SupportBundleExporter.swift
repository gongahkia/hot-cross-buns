import AppKit
import Foundation
import UniformTypeIdentifiers

enum SupportBundleExporter {
    @MainActor
    static func export(report: DiagnosticReport, session: AppSession) async throws {
        let destination = try chooseDestination()
        let fileManager = FileManager.default
        let staging = fileManager.temporaryDirectory
            .appendingPathComponent("MelonPanDiagnostics-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: staging) }

        try report.toJSONData().write(to: staging.appendingPathComponent("report.json"))
        try report.toPlainText().write(
            to: staging.appendingPathComponent("report.txt"),
            atomically: true,
            encoding: .utf8
        )
        copyWindowsJSON(into: staging)
        copyMetadata(cacheRoot: session.cacheRoot, into: staging)

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try zip(staging: staging, destination: destination)
    }

    @MainActor
    private static func chooseDestination() throws -> URL {
        let panel = NSSavePanel()
        panel.title = "Export Melon Pan Support Bundle"
        panel.nameFieldStringValue = "MelonPan-Diagnostics-\(dateStamp()).zip"
        panel.allowedContentTypes = [UTType(filenameExtension: "zip") ?? .zip]
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else {
            throw CancellationError()
        }
        return url
    }

    private static func copyWindowsJSON(into staging: URL) {
        let credentials = RuntimeBridge.defaultCredentialsPath()
        let source = URL(fileURLWithPath: credentials)
            .deletingLastPathComponent()
            .appendingPathComponent("windows.json")
        let target = staging.appendingPathComponent("windows.json")
        if FileManager.default.fileExists(atPath: source.path) {
            try? FileManager.default.copyItem(at: source, to: target)
        } else {
            try? #"{"activeDocumentId":null,"openDocuments":[]}"#.write(
                to: target,
                atomically: true,
                encoding: .utf8
            )
        }
    }

    private static func copyMetadata(cacheRoot: String, into staging: URL) {
        let docsDir = staging.appendingPathComponent("docs", isDirectory: true)
        try? FileManager.default.createDirectory(at: docsDir, withIntermediateDirectories: true)
        let sourceDocs = URL(fileURLWithPath: cacheRoot).appendingPathComponent("docs")
        let docDirs = (try? FileManager.default.contentsOfDirectory(
            at: sourceDocs,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []
        for docDir in docDirs {
            let source = docDir.appendingPathComponent("meta.json")
            guard FileManager.default.fileExists(atPath: source.path) else { continue }
            let targetDir = docsDir.appendingPathComponent(docDir.lastPathComponent, isDirectory: true)
            try? FileManager.default.createDirectory(at: targetDir, withIntermediateDirectories: true)
            try? FileManager.default.copyItem(
                at: source,
                to: targetDir.appendingPathComponent("meta.json")
            )
        }
    }

    private static func zip(staging: URL, destination: URL) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
        process.arguments = ["-qry", destination.path, "."]
        process.currentDirectoryURL = staging
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw RuntimeBridgeError.ffi("zip exited with status \(process.terminationStatus)")
        }
    }

    private static func dateStamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}
