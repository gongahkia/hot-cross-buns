import SwiftUI

struct RecurrenceEditor: View {
    @Binding var rule: RecurrenceRule?

    @State private var isCustomExpanded: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Repeat", selection: frequencyBinding) {
                Text("None").tag(RecurrenceFrequency?.none)
                ForEach(RecurrenceFrequency.allCases, id: \.self) { f in
                    Text(f.title).tag(Optional(f))
                }
            }
            .pickerStyle(.menu)

            if rule != nil {
                DisclosureGroup("Custom", isExpanded: $isCustomExpanded) {
                    intervalStepper
                }
                .hcbScaledPadding(.leading, 4)
            }
        }
        .onChange(of: rule) { _, newValue in
            if newValue == nil { isCustomExpanded = false }
        }
    }

    private var frequencyBinding: Binding<RecurrenceFrequency?> {
        Binding(
            get: { rule?.frequency },
            set: { newValue in
                if let newValue {
                    rule = RecurrenceRule(frequency: newValue, interval: rule?.interval ?? 1)
                } else {
                    rule = nil
                }
            }
        )
    }

    private var intervalStepper: some View {
        HStack {
            Text("Every")
            Stepper(value: intervalBinding, in: 1...99) {
                Text("\(rule?.interval ?? 1) \(frequencyLabelPlural)")
                    .monospacedDigit()
            }
        }
        .hcbScaledPadding(.vertical, 6)
    }

    private var intervalBinding: Binding<Int> {
        Binding(
            get: { rule?.interval ?? 1 },
            set: { newValue in
                guard let existing = rule else { return }
                rule = RecurrenceRule(frequency: existing.frequency, interval: newValue)
            }
        )
    }

    private var frequencyLabelPlural: String {
        guard let frequency = rule?.frequency else { return "days" }
        let interval = rule?.interval ?? 1
        let singular: String = switch frequency {
        case .daily: "day"
        case .weekly: "week"
        case .monthly: "month"
        case .yearly: "year"
        }
        return interval == 1 ? singular : singular + "s"
    }
}
