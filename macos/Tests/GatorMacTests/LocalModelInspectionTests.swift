import AppKit
import Darwin
import SwiftUI
import Testing
@testable import GatorCore
@testable import GatorMac

private struct InspectionResource: Codable {
    let wall, cpu: Double
    let rss, footprint: UInt64
    static func sample() -> Self {
        var usage = rusage(); getrusage(RUSAGE_SELF, &usage)
        var vm = task_vm_info_data_t(), count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &vm) { p in
            p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return Self(wall: Date().timeIntervalSince1970, cpu: Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1e6, rss: status == KERN_SUCCESS ? vm.resident_size : 0, footprint: status == KERN_SUCCESS ? vm.phys_footprint : 0)
    }
}
private func inspectionFixture(_ request: NativeProviderRequest, missing: Bool = false) throws -> NativeProviderResult {
    let model: [String: Any] = ["id":"qwen3-4b","name":"Qwen3 4B","tag":"qwen3:4b","digest":"sha256:inert","size":2500000000,"downloaded":true,"loaded":false,"eligible":true,"reason":"","source":"https://ollama.com/library/qwen3"]
    let local: [String: Any] = ["result_id":"hosted-observation","observed_at":"2026-11-21T01:00:00Z","runtime_path":missing ? "" : "/fixture/ollama","discovery":"Fixture locations only","reachable":!missing,"version":missing ? "" : "fixture","ownership":"Unknown","endpoint":"http://127.0.0.1:9","issue":"","installed_known":true,"loaded_known":true,"selected_provider":"openai","selected_model":"future-fixture","total_memory":17179869184,"available_memory":NSNull(),"available_disk":NSNull(),"hardware_note":"Available memory and pressure unknown; eligibility is not live verification.","catalog":(0..<64).map { index -> [String: Any] in var row = model; row["id"]="catalog-\(index)"; return row },"installed":(0..<256).map { index -> [String: Any] in var row = model; row["id"]="installed-\(index)"; return row },"blocked":"Initial local selection awaits P04L-2B. Destructive operations blocked pending leases and durable receipts."]
    let value: [String: Any] = ["request_id":request.id,"action":request.action.rawValue,"local":local,"rows":[],"confirmed":false,"changed":false,"conflict":false]
    return try NativeProviderResult(JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: value)))
}

// Hosted component capture only: no window is ordered onscreen and no desktop input is sent.
@Test @MainActor func localInspectionHostedAppearanceAndBoundedLifetime() async throws {
    let setup = NativeProviderSetup()
    setup.present { try inspectionFixture($0) }
    await setup.refreshLocal()
    #expect(setup.localStatus?.catalog.count == 64 && setup.localStatus?.installed.count == 256)
    let output = ProcessInfo.processInfo.environment["GATOR_L2A_COMPONENT_EVIDENCE"].map { URL(fileURLWithPath: $0) }
    if let output { try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true) }
    var samples = [InspectionResource.sample()]
    var layoutMS: [Double] = []
    var liveWindows = 0
        var survivingHosts: [Int] = []
        var probes: [InspectionWeakProbe] = []
    for index in 0..<12 {
        do {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: index % 2 == 0 ? 820 : 560, height: 640), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let host = NSHostingView(rootView: LocalModelInspectionView(setup: setup))
        host.appearance = NSAppearance(named: index % 2 == 0 ? .aqua : .darkAqua)
        window.contentView = host
        probes.append(InspectionWeakProbe(host))
        let start = ContinuousClock.now
        host.layoutSubtreeIfNeeded()
        let elapsed = start.duration(to: .now).components
        layoutMS.append(Double(elapsed.seconds) * 1000 + Double(elapsed.attoseconds) / 1e15)
        #expect(!window.isKeyWindow && !window.isVisible)
        #expect(host.bounds.width.isFinite && host.bounds.height.isFinite)
        if index < 2, let output {
            let renderer = ImageRenderer(content: NativeLocalRuntimeDetails(status: try #require(setup.localStatus))
                .padding(18).frame(width: index == 0 ? 820 : 560, height: 640, alignment: .topLeading)
                .environment(\.colorScheme, index == 0 ? .light : .dark)
                .background(index == 0 ? Color.white : Color(white: 0.12)))
            renderer.scale = 1
            if let image = renderer.cgImage {
                let bitmap = NSBitmapImageRep(cgImage: image)
                let background = index == 0 ? 1.0 : 0.12
                var contrastPixels = 0
                for y in stride(from: 0, to: bitmap.pixelsHigh, by: 8) {
                    for x in stride(from: 0, to: bitmap.pixelsWide, by: 8) {
                        if let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB), abs(color.redComponent - background) > 0.08 { contrastPixels += 1 }
                    }
                }
                #expect(contrastPixels > 10, "Hosted component raster must contain readable content")
                if let data = bitmap.representation(using: .png, properties: [:]) { try data.write(to: output.appendingPathComponent(index == 0 ? "runtime-details-light-hosted.png" : "runtime-details-dark-minimum-hosted.png")) }
            }
        }
        samples.append(InspectionResource.sample())
        window.contentView = nil; window.close()
        #expect(window.contentView == nil)
        liveWindows += window.isVisible ? 1 : 0
        }
        try await Task.sleep(for: .milliseconds(150))
        survivingHosts.append(probes.filter { $0.value != nil }.count)
        samples.append(InspectionResource.sample())
    }
    #expect(liveWindows == 0)
    #expect(survivingHosts.allSatisfy { $0 == 0 })
    let beforeIdle = InspectionResource.sample()
    try await Task.sleep(for: .seconds(2))
    samples.append(InspectionResource.sample())
    setup.dismiss()
    #expect(setup.localStatus == nil && !setup.retainsHost)
    if let output {
        let data = try JSONEncoder().encode(samples); try data.write(to: output.appendingPathComponent("hosted-resources.json"))
        let end = samples.last ?? beforeIdle
        let metrics: [String: Any] = ["layout_ms":layoutMS,"idle_cpu_one_core_percent":100 * (end.cpu-beforeIdle.cpu)/(end.wall-beforeIdle.wall),"visible_windows_after_cycles":liveWindows,"cycles":12,"surviving_hosts_after_settle":survivingHosts,"catalog_rows":64,"installed_rows":256,"kind":"hidden hosted component; not full-app or desktop performance"]
        try JSONSerialization.data(withJSONObject: metrics, options: [.prettyPrinted,.sortedKeys]).write(to: output.appendingPathComponent("hosted-summary.json"))
    }
}

@MainActor private final class InspectionWeakProbe {
    weak var value: AnyObject?
    init(_ value: AnyObject) { self.value = value }
}

@Test @MainActor func localOnboardingHostedMissingRuntimeAndReviewAreReadable() async throws {
    let setup = NativeProviderSetup()
    let output = ProcessInfo.processInfo.environment["GATOR_L2B_COMPONENT_EVIDENCE"].map { URL(fileURLWithPath: $0) }
    if let output { try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true) }
    let missing = try #require(inspectionFixture(NativeProviderRequest(.local_status),missing:true).local)
    let data = Data(#"{"id":"review","generation":"generation","model_id":"qwen3-4b","tag":"qwen3:4b","digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","endpoint":"http://127.0.0.1:9","settings_revision":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","notice":"Future work only. No weights are loaded or live-tested."}"#.utf8)
    let review = try JSONDecoder().decode(NativeLocalSelectionReview.self,from:data)
    for dark in [false,true] {
        let content = VStack(alignment:.leading,spacing:18) {
            LocalModelOnboardingView(status:missing)
            Divider()
            LocalModelSelectionReviewView(setup:setup,review:review)
        }.padding(18).frame(width:560,height:700,alignment:.topLeading)
            .environment(\.colorScheme,dark ? .dark : .light)
            .background(dark ? Color(white:0.12) : .white)
        let renderer = ImageRenderer(content:content);renderer.scale=1
        let image=try #require(renderer.cgImage)
        #expect(image.width==560 && image.height==700)
        if let output {
            let bitmap=NSBitmapImageRep(cgImage:image)
            let png=try #require(bitmap.representation(using:.png,properties:[:]))
            try png.write(to:output.appendingPathComponent(dark ? "onboarding-review-dark.png" : "onboarding-review-light.png"))
        }
    }
}
