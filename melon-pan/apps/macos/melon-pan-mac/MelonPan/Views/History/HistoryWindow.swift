import SwiftUI

struct HistoryWindow: View {
    enum Presentation {
        case window
        case embedded
    }

    @ObservedObject private var session: AppSession
    @StateObject private var vm: HistoryViewModel
    @State private var confirmClearJournal = false
    private let presentation: Presentation

    init(session: AppSession, presentation: Presentation = .window) {
        self.session = session
        self.presentation = presentation
        _vm = StateObject(wrappedValue: HistoryViewModel(
            cacheRoot: session.cacheRoot,
            configRoot: session.configRoot
        ))
    }

    var body: some View {
        configuredSplitView
    }

    @ViewBuilder
    private var configuredSplitView: some View {
        let splitView = historySplitView
            .environmentObject(vm)
            .task {
                await vm.reload()
                applyRequestedDocumentFilter()
            }
            .onChange(of: vm.filter) { _ in vm.applyFilter() }
            .onChange(of: session.historyRequestToken) { _ in
                applyRequestedDocumentFilter()
            }
            .confirmationDialog(
                "Clear sync journal?",
                isPresented: $confirmClearJournal,
                titleVisibility: .visible
            ) {
                Button("Clear all", role: .destructive) {
                    Task {
                        do {
                            try await vm.clearJournal(retainDays: 0)
                        } catch {
                            vm.lastError = "\(error)"
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes every visible sync event from sync-journal.jsonl.")
            }

        switch presentation {
        case .window:
            splitView
                .toolbar { toolbarContent }
                .searchable(text: $vm.filter.searchText, placement: .toolbar)
                .frame(minWidth: 820, minHeight: 520)
        case .embedded:
            VStack(spacing: 0) {
                embeddedToolbar
                Divider()
                splitView
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var historySplitView: some View {
        NavigationSplitView {
            List(HistoryViewModel.Tab.allCases, selection: $vm.activeTab) { tab in
                Label(tab.label, systemImage: tab.systemImage).tag(tab)
            }
            .navigationTitle("History")
            .navigationSplitViewColumnWidth(min: 170, ideal: 200, max: 230)
        } content: {
            currentList
                .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 460)
        } detail: {
            detailPane
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private var currentList: some View {
        switch vm.activeTab {
        case .events:
            eventsList
        case .snapshots:
            SnapshotBrowser()
                .environmentObject(vm)
        case .openHistory:
            openHistoryList
        }
    }

    private var embeddedToolbar: some View {
        HStack(spacing: 10) {
            Button {
                Task { await vm.reload() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .labelStyle(.iconOnly)
            .help("Refresh history")

            Button(role: .destructive) {
                confirmClearJournal = true
            } label: {
                Label("Clear journal", systemImage: "trash")
            }
            .labelStyle(.iconOnly)
            .help("Clear sync journal")

            Spacer(minLength: 16)

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search", text: $vm.filter.searchText)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(width: 260)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var eventsList: some View {
        VStack(spacing: 0) {
            HistoryFilterChips(filter: $vm.filter, documentIds: vm.documentIds)
            Divider()
            if vm.loading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if vm.visibleEvents.isEmpty {
                HistoryPlaceholder(
                    title: "No events",
                    systemImage: "clock.arrow.circlepath",
                    message: vm.events.isEmpty ? "Sync events will appear here." : "No events match the current filters."
                )
            } else {
                List(selection: $vm.selectedEvent) {
                    ForEach(vm.visibleEvents) { event in
                        HistoryEntryRow(event: event)
                            .tag(event)
                    }
                }
                .listStyle(.inset)
            }
            footer
        }
    }

    private var openHistoryList: some View {
        List(vm.openHistory) { entry in
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.entry)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("Double-click to open")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                session.openHistoryEntry(entry.entry)
            }
        }
        .overlay {
            if vm.openHistory.isEmpty {
                HistoryPlaceholder(
                    title: "No recently opened docs",
                    systemImage: "doc.text.magnifyingglass"
                )
            }
        }
    }

    @ViewBuilder
    private var detailPane: some View {
        switch vm.activeTab {
        case .events:
            if let event = vm.selectedEvent {
                HistoryEventDetail(event: event)
                    .environmentObject(vm)
            } else {
                HistoryPlaceholder(title: "Select an event", systemImage: "clock")
            }
        case .snapshots:
            if let snapshot = vm.selectedSnapshot {
                SnapshotDetail(snapshot: snapshot)
                    .environmentObject(vm)
                    .environmentObject(session)
            } else {
                HistoryPlaceholder(title: "Select a snapshot", systemImage: "tray.full")
            }
        case .openHistory:
            HistoryPlaceholder(title: "Open a recent document", systemImage: "doc.text")
        }
    }

    private var footer: some View {
        HStack {
            Text("\(vm.visibleEvents.count) of \(vm.events.count) events")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let error = vm.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                Task { await vm.reload() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .help("Refresh history")

            Button(role: .destructive) {
                confirmClearJournal = true
            } label: {
                Label("Clear journal", systemImage: "trash")
            }
            .keyboardShortcut(.delete, modifiers: .command)
            .help("Clear sync journal")
        }
    }

    private func applyRequestedDocumentFilter() {
        if let documentId = session.historyDocumentIdFilter {
            vm.focus(documentId: documentId)
        } else {
            vm.filter.documentId = nil
            vm.applyFilter()
        }
    }
}

private struct HistoryPlaceholder: View {
    let title: String
    let systemImage: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            if let message {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
