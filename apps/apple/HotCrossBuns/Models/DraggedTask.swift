import Foundation
import CoreTransferable
import UniformTypeIdentifiers

struct DraggedTask: Codable, Transferable, Equatable, Sendable {
    let taskID: String
    let taskListID: String
    let title: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .json)
    }
}
