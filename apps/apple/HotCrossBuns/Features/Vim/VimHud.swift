import Observation
import SwiftUI

@MainActor
@Observable
final class VimState {
    var pendingChord: String?
    var isCheatsheetVisible: Bool = false
}

struct VimHud: View {
    @Environment(VimState.self) private var state

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            HStack {
                Spacer(minLength: 0)
                if let pending = state.pendingChord {
                    chordChip(pending)
                        .hcbScaledPadding(14)
                }
            }
        }
        .allowsHitTesting(false)
        .overlay {
            if state.isCheatsheetVisible {
                cheatsheetOverlay
            }
        }
    }

    private func chordChip(_ chord: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "keyboard")
            Text("\(chord)…")
                .font(.caption.monospaced())
        }
        .hcbScaledPadding(.horizontal, 10)
        .hcbScaledPadding(.vertical, 6)
        .background(
            Capsule().fill(.ultraThickMaterial)
        )
        .overlay(
            Capsule().strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
        )
        .shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 2)
    }

    private var cheatsheetOverlay: some View {
        ZStack {
            Color.black.opacity(0.35)
                .ignoresSafeArea()
                .onTapGesture { @MainActor in
                    state.isCheatsheetVisible = false
                }

            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Image(systemName: "keyboard")
                    Text("Vim Keybindings").hcbFont(.headline)
                    Spacer()
                    Text("Esc or ? to close")
                        .hcbFont(.caption2)
                        .foregroundStyle(.secondary)
                }

                bindingsGrid

                Text("Text editors keep native macOS shortcuts. Modifier-key shortcuts (⌘, ⌃, ⌥) pass through.")
                    .hcbFont(.caption)
                    .foregroundStyle(.secondary)
            }
            .hcbScaledPadding(22)
            .hcbScaledFrame(width: 460)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(AppColor.cardStroke, lineWidth: 0.8)
            )
        }
        .allowsHitTesting(true)
    }

    private var bindingsGrid: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(bindings, id: \.keys) { binding in
                HStack(alignment: .top, spacing: 16) {
                    Text(binding.keys)
                        .font(.subheadline.monospaced().weight(.semibold))
                        .hcbScaledFrame(width: 70, alignment: .leading)
                    Text(binding.label)
                        .hcbFont(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var bindings: [(keys: String, label: String)] {
        [
            ("j / k", "Move selection down / up"),
            ("l", "Enter selection (focus detail pane)"),
            ("h", "Back out (focus sidebar)"),
            ("gg", "Jump to top"),
            ("G", "Jump to bottom"),
            ("x", "Toggle complete on selection"),
            ("dd", "Delete selected task"),
            (":", "Open command palette"),
            ("/", "Search tasks and events (opens palette)"),
            ("?", "Show / hide this cheatsheet")
        ]
    }
}
