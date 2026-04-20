import SwiftUI

struct LayoutSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Section("Layout") {
            sidebarTabsBlock
            Divider()
            calendarViewsBlock
            Divider()
            storeViewsBlock
            Divider()
            quickCreateBlock
        }
    }

    private var quickCreateBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Quick create popover")
                .hcbFont(.subheadline, weight: .medium)
            Toggle(isOn: quickCreateExpandedBinding) {
                Label("Show all fields by default", systemImage: "rectangle.expand.vertical")
            }
            Text("Off: the popover starts compact and hides optional fields behind \"More\". On: the popover opens detailed — matches Apple Calendar's inline expansion.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var quickCreateExpandedBinding: Binding<Bool> {
        Binding(
            get: { model.settings.quickCreateExpandedByDefault },
            set: { newValue in
                var next = model.settings
                next.quickCreateExpandedByDefault = newValue
                model.updateSettings(next)
            }
        )
    }

    private var sidebarTabsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Sidebar tabs")
                .hcbFont(.subheadline, weight: .medium)
            ForEach(SidebarItem.allCases.filter(\.isHideable)) { item in
                Toggle(isOn: sidebarItemVisibleBinding(item)) {
                    Label(item.title, systemImage: item.systemImage)
                }
            }
            Text("Settings always stays visible so you can re-enable hidden tabs. Keyboard shortcuts for a hidden tab are ignored until it's re-enabled.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var calendarViewsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Calendar view modes")
                .hcbFont(.subheadline, weight: .medium)
            ForEach(CalendarGridMode.allCases, id: \.self) { mode in
                Toggle(isOn: calendarModeVisibleBinding(mode)) {
                    Label(mode.title, systemImage: mode.systemImage)
                }
                .disabled(isLastVisibleMode(mode))
            }
            Text("Hidden modes disappear from the Calendar view picker. At least one mode stays visible.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var storeViewsBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Store view modes")
                .hcbFont(.subheadline, weight: .medium)
            ForEach(StoreViewMode.allCases, id: \.self) { mode in
                Toggle(isOn: storeModeVisibleBinding(mode)) {
                    Label(mode.title, systemImage: mode.systemImage)
                }
                .disabled(isLastVisibleStoreMode(mode))
            }
            Text("Hidden modes disappear from the Store view picker. At least one mode stays visible.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func sidebarItemVisibleBinding(_ item: SidebarItem) -> Binding<Bool> {
        Binding(
            get: { model.settings.hiddenSidebarItems.contains(item.rawValue) == false },
            set: { isVisible in model.setSidebarItemHidden(item, hidden: isVisible == false) }
        )
    }

    private func calendarModeVisibleBinding(_ mode: CalendarGridMode) -> Binding<Bool> {
        Binding(
            get: { model.settings.hiddenCalendarViewModes.contains(mode.rawValue) == false },
            set: { isVisible in model.setCalendarViewModeHidden(mode, hidden: isVisible == false) }
        )
    }

    // Disables the toggle for the only remaining visible mode, so the UI
    // matches the setter's guard (which also refuses to hide the last mode).
    private func isLastVisibleMode(_ mode: CalendarGridMode) -> Bool {
        guard model.settings.hiddenCalendarViewModes.contains(mode.rawValue) == false else { return false }
        let visibleCount = CalendarGridMode.allCases.reduce(0) { acc, m in
            acc + (model.settings.hiddenCalendarViewModes.contains(m.rawValue) ? 0 : 1)
        }
        return visibleCount <= 1
    }

    private func storeModeVisibleBinding(_ mode: StoreViewMode) -> Binding<Bool> {
        Binding(
            get: { model.settings.hiddenStoreViewModes.contains(mode.rawValue) == false },
            set: { isVisible in model.setStoreViewModeHidden(mode, hidden: isVisible == false) }
        )
    }

    private func isLastVisibleStoreMode(_ mode: StoreViewMode) -> Bool {
        guard model.settings.hiddenStoreViewModes.contains(mode.rawValue) == false else { return false }
        let visibleCount = StoreViewMode.allCases.reduce(0) { acc, m in
            acc + (model.settings.hiddenStoreViewModes.contains(m.rawValue) ? 0 : 1)
        }
        return visibleCount <= 1
    }
}
