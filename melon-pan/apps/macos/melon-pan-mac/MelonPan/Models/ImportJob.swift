import Foundation

struct ImportJob: Identifiable, Equatable {
    enum Status: Equatable {
        case pending
        case running
        case succeeded(draftId: String, pushedDocumentId: String?)
        case skipped(reason: String)
        case failed(reason: String)
    }

    let id = UUID()
    let sourcePath: URL
    var targetDraftId: String
    var status: Status = .pending
    var byteSize: Int64 = 0
}
