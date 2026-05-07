import SwiftUI

struct HelpSearchField: ViewModifier {
    @ObservedObject var model: HelpViewModel
    let onSubmit: () -> Void

    func body(content: Content) -> some View {
        content
            .searchable(text: $model.query, prompt: "Search help")
            .onSubmit(of: .search, onSubmit)
    }
}

extension View {
    func helpSearchField(model: HelpViewModel, onSubmit: @escaping () -> Void) -> some View {
        modifier(HelpSearchField(model: model, onSubmit: onSubmit))
    }
}
