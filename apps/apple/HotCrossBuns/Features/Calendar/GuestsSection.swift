import SwiftUI

struct GuestsSection: View {
    @Binding var attendees: [String]
    @Binding var draft: String
    @Binding var notifyGuests: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Add guest email", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(addDraft)
                Button {
                    addDraft()
                } label: {
                    Label("Add", systemImage: "plus")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(.bordered)
                .disabled(isDraftValid == false)
            }
            if isDraftValid == false, draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
                Text("That doesn't look like a valid email address.")
                    .hcbFont(.caption2)
                    .foregroundStyle(AppColor.ember)
            }

            if attendees.isEmpty == false {
                VStack(spacing: 4) {
                    ForEach(attendees, id: \.self) { email in
                        HStack(spacing: 8) {
                            Image(systemName: "person.crop.circle")
                                .foregroundStyle(.secondary)
                            Text(email)
                                .hcbFont(.subheadline)
                            Spacer()
                            Button {
                                attendees.removeAll { $0 == email }
                            } label: {
                                Image(systemName: "xmark.circle")
                                    .hcbFont(.caption)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove \(email)")
                        }
                    }
                }
            }

            Toggle("Send updates to guests", isOn: $notifyGuests)
                .disabled(attendees.isEmpty)
            Text("Off by default to avoid accidental emails. Turn on only when you want guests to get a notification for this change.")
                .hcbFont(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func addDraft() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isPlausibleEmail(trimmed) else { return }
        if attendees.contains(where: { $0.caseInsensitiveCompare(trimmed) == .orderedSame }) == false {
            attendees.append(trimmed)
        }
        draft = ""
    }

    private var isDraftValid: Bool {
        Self.isPlausibleEmail(draft.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // Lightweight RFC-5322-subset check. Requires exactly one '@', at
    // least one character before and after, a '.' in the domain, and no
    // whitespace anywhere. Rejects the common bad pastes ("@channel",
    // "name@", "@email") that the previous contains("@") accepted.
    static func isPlausibleEmail(_ candidate: String) -> Bool {
        guard candidate.isEmpty == false else { return false }
        let pattern = #"^[^@\s]+@[^@\s]+\.[^@\s]+$"#
        return candidate.range(of: pattern, options: .regularExpression) != nil
    }
}
