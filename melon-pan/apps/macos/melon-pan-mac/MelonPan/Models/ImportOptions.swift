public struct ImportOptions: Codable, Equatable {
    public enum Collision: String, Codable, CaseIterable, Identifiable {
        case skip
        case rename
        case overwrite

        public var id: String { rawValue }
    }

    public var pushToDrive: Bool = false
    public var targetDriveFolderId: String? = nil
    public var collision: Collision = .skip
    public var maxFolderFiles: Int = 200

    public init(
        pushToDrive: Bool = false,
        targetDriveFolderId: String? = nil,
        collision: Collision = .skip,
        maxFolderFiles: Int = 200
    ) {
        self.pushToDrive = pushToDrive
        self.targetDriveFolderId = targetDriveFolderId
        self.collision = collision
        self.maxFolderFiles = maxFolderFiles
    }
}
