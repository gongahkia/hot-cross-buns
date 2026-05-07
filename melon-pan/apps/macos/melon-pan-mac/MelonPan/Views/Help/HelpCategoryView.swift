import SwiftUI

struct HelpCategoryView: View {
    let category: HelpCategory
    @EnvironmentObject private var model: HelpViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(category.title)
                    .font(.title2)
                    .fontWeight(.semibold)
                Text(model.body(for: category))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !category.inlineShortcuts.isEmpty {
                    Divider()
                    ShortcutTable(entries: category.inlineShortcuts, highlight: model.query)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(category.title)
    }
}
