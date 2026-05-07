import SwiftUI

struct DiagnosticsTabBar: View {
    @Environment(\.appTheme) private var theme
    @Binding var selection: DiagnosticsPane.Tab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(DiagnosticsPane.Tab.allCases) { tab in
                tabButton(tab)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(theme.elevatedSurface)
    }

    private func tabButton(_ tab: DiagnosticsPane.Tab) -> some View {
        let selected = selection == tab
        return Button {
            selection = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 18, weight: selected ? .semibold : .regular))
                Text(tab.title)
                    .font(.caption.weight(selected ? .semibold : .regular))
            }
            .foregroundStyle(selected ? theme.accent : theme.secondaryForeground)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
            .padding(.horizontal, 12)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(selected ? theme.selection.opacity(0.72) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
