import SwiftUI
import MapKit
import CoreLocation

// Geocodes the free-text location string and renders a small MapKit preview
// with a marker pin, similar to Google Calendar's inline map. Silently
// renders nothing when geocoding fails — a map error shouldn't block the
// create/edit flow.
struct LocationMapPreview: View {
    let locationText: String
    @State private var coordinate: CLLocationCoordinate2D?
    @State private var resolvedLocation: String = ""
    @State private var isGeocoding = false

    var body: some View {
        Group {
            if let coord = coordinate {
                Map(initialPosition: .region(region(for: coord))) {
                    Marker(resolvedLocation.isEmpty ? locationText : resolvedLocation, coordinate: coord)
                        .tint(AppColor.ember)
                }
                .frame(height: 140)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(AppColor.cardStroke, lineWidth: 0.6)
                )
                .overlay(alignment: .topTrailing) {
                    Button {
                        openInMaps(coordinate: coord, label: locationText)
                    } label: {
                        Label("Maps", systemImage: "arrow.up.right.square")
                            .hcbFont(.caption, weight: .semibold)
                            .hcbScaledPadding(.horizontal, 8)
                            .hcbScaledPadding(.vertical, 4)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(.thinMaterial)
                            )
                    }
                    .buttonStyle(.plain)
                    .hcbScaledPadding(6)
                }
            } else if isGeocoding {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Looking up location…")
                        .hcbFont(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .hcbScaledPadding(.vertical, 4)
            }
        }
        .task(id: locationText) {
            await geocode()
        }
    }

    private func region(for coord: CLLocationCoordinate2D) -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: coord,
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        )
    }

    private func geocode() async {
        let trimmed = locationText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            coordinate = nil
            resolvedLocation = ""
            return
        }
        // Debounce: short delay so each keystroke doesn't fire a geocode.
        try? await Task.sleep(nanoseconds: 400_000_000)
        if Task.isCancelled { return }
        isGeocoding = true
        defer { isGeocoding = false }
        let geocoder = CLGeocoder()
        do {
            let placemarks = try await geocoder.geocodeAddressString(trimmed)
            if let first = placemarks.first, let location = first.location {
                coordinate = location.coordinate
                resolvedLocation = [first.name, first.locality, first.administrativeArea]
                    .compactMap { $0 }
                    .joined(separator: ", ")
            } else {
                coordinate = nil
            }
        } catch {
            coordinate = nil
        }
    }

    private func openInMaps(coordinate: CLLocationCoordinate2D, label: String) {
        let placemark = MKPlacemark(coordinate: coordinate)
        let item = MKMapItem(placemark: placemark)
        item.name = label.isEmpty ? "Location" : label
        item.openInMaps()
    }
}
