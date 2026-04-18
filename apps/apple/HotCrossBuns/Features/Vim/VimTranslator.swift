import Foundation

enum VimAction: Equatable, Sendable {
    case moveDown
    case moveUp
    case scrollTop
    case scrollBottom
    case toggleComplete
    case deleteSelection
    case openCommandPalette
    case focusSearch
    case toggleCheatsheet
}

struct VimTranslator: Equatable {
    private(set) var pending: Character?

    mutating func reset() {
        pending = nil
    }

    mutating func consume(_ character: Character) -> VimAction? {
        if let pendingChar = pending {
            pending = nil
            switch (pendingChar, character) {
            case ("g", "g"): return .scrollTop
            case ("d", "d"): return .deleteSelection
            default:
                return consumeFresh(character)
            }
        }
        return consumeFresh(character)
    }

    private mutating func consumeFresh(_ character: Character) -> VimAction? {
        switch character {
        case "j": return .moveDown
        case "k": return .moveUp
        case "x": return .toggleComplete
        case ":": return .openCommandPalette
        case "/": return .focusSearch
        case "G": return .scrollBottom
        case "?": return .toggleCheatsheet
        case "g", "d":
            pending = character
            return nil
        default:
            return nil
        }
    }
}
