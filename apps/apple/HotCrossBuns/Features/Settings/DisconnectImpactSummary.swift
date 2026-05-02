import Foundation

struct DisconnectImpactSummary: Equatable {
    var accountName: String
    var cacheFootprint: String
    var pendingMutationCount: Int
    var conflictedMutationCount: Int
    var quarantinedMutationCount: Int
    var invalidPayloadMutationCount: Int

    var confirmationMessage: String {
        let pendingNoun = pendingMutationCount == 1 ? "queued local write" : "queued local writes"
        var lines = [
            "This signs out \(accountName) on this Mac and removes the saved Google session from Keychain.",
            "Google Tasks and Calendar data in your Google account will not be deleted.",
            "Local cache retained on this Mac: \(cacheFootprint).",
            "Local Spotlight search results will be removed until you reconnect and sync again.",
            "Pending sync work: \(pendingMutationCount) \(pendingNoun)."
        ]

        let flagged = flaggedMutationSummary
        if flagged.isEmpty == false {
            lines.append("Needs attention: \(flagged).")
        }

        if pendingMutationCount > 0 {
            lines.append("Queued writes stay stored locally, but they cannot reach Google while disconnected.")
        }

        return lines.joined(separator: "\n\n")
    }

    private var flaggedMutationSummary: String {
        var parts: [String] = []
        if conflictedMutationCount > 0 {
            parts.append("\(conflictedMutationCount) conflict\(conflictedMutationCount == 1 ? "" : "s")")
        }
        if quarantinedMutationCount > 0 {
            parts.append("\(quarantinedMutationCount) quarantined")
        }
        if invalidPayloadMutationCount > 0 {
            parts.append("\(invalidPayloadMutationCount) invalid")
        }
        return parts.joined(separator: ", ")
    }
}
