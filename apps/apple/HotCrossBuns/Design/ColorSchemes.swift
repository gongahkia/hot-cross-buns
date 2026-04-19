import AppKit
import SwiftUI

// A named palette for the app. Every HCBColorScheme provides the full set
// of semantic colors AppColor depends on. One palette is active at a time
// (HCBColorSchemeStore.current); changing it updates every AppColor.X
// accessor via a .id() flip at the shell root.
struct HCBColorScheme: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let isDark: Bool
    let ember: RGB // accent / primary CTA
    let moss: RGB // success
    let blue: RGB // info / link
    let ink: RGB // primary text
    let cream: RGB // background
    let cardStroke: RGB // card border / divider

    struct RGB: Hashable, Sendable {
        let red: Double
        let green: Double
        let blue: Double
        let alpha: Double

        init(_ hex: String, alpha: Double = 1.0) {
            let normalized = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
            var value: UInt64 = 0
            Scanner(string: normalized).scanHexInt64(&value)
            self.red = Double((value >> 16) & 0xff) / 255.0
            self.green = Double((value >> 8) & 0xff) / 255.0
            self.blue = Double(value & 0xff) / 255.0
            self.alpha = alpha
        }

        init(red: Double, green: Double, blue: Double, alpha: Double = 1.0) {
            self.red = red
            self.green = green
            self.blue = blue
            self.alpha = alpha
        }

        var nsColor: NSColor {
            NSColor(red: red, green: green, blue: blue, alpha: alpha)
        }

        var swiftColor: Color {
            Color(red: red, green: green, blue: blue).opacity(alpha)
        }
    }
}

extension HCBColorScheme {
    static let notion = HCBColorScheme(
        id: "notion",
        title: "Notion",
        isDark: false,
        ember: .init("2383E2"),
        moss: .init("448361"),
        blue: .init("2383E2"),
        ink: .init("37352F"),
        cream: .init("FFFFFF"),
        cardStroke: .init("E5E5E5")
    )

    static let hotCrossBuns = HCBColorScheme(
        id: "hotcrossbuns",
        title: "Hot Cross Buns",
        isDark: false,
        ember: .init(red: 0.965, green: 0.420, blue: 0.231),
        moss: .init(red: 0.235, green: 0.447, blue: 0.333),
        blue: .init(red: 0.086, green: 0.467, blue: 1.000),
        ink: .init(red: 0.106, green: 0.118, blue: 0.145),
        cream: .init(red: 0.988, green: 0.957, blue: 0.894),
        cardStroke: .init(red: 0, green: 0, blue: 0, alpha: 0.08)
    )

    static let dracula = HCBColorScheme(
        id: "dracula",
        title: "Dracula",
        isDark: true,
        ember: .init("FF79C6"),
        moss: .init("50FA7B"),
        blue: .init("8BE9FD"),
        ink: .init("F8F8F2"),
        cream: .init("282A36"),
        cardStroke: .init("44475A")
    )

    static let oneDarkPro = HCBColorScheme(
        id: "oneDarkPro",
        title: "One Dark Pro",
        isDark: true,
        ember: .init("E06C75"),
        moss: .init("98C379"),
        blue: .init("61AFEF"),
        ink: .init("ABB2BF"),
        cream: .init("282C34"),
        cardStroke: .init("3E4451")
    )

    static let solarizedLight = HCBColorScheme(
        id: "solarizedLight",
        title: "Solarized Light",
        isDark: false,
        ember: .init("CB4B16"),
        moss: .init("859900"),
        blue: .init("268BD2"),
        ink: .init("586E75"),
        cream: .init("FDF6E3"),
        cardStroke: .init("EEE8D5")
    )

    static let solarizedDark = HCBColorScheme(
        id: "solarizedDark",
        title: "Solarized Dark",
        isDark: true,
        ember: .init("CB4B16"),
        moss: .init("859900"),
        blue: .init("268BD2"),
        ink: .init("839496"),
        cream: .init("002B36"),
        cardStroke: .init("073642")
    )

    static let nord = HCBColorScheme(
        id: "nord",
        title: "Nord",
        isDark: true,
        ember: .init("88C0D0"),
        moss: .init("A3BE8C"),
        blue: .init("81A1C1"),
        ink: .init("D8DEE9"),
        cream: .init("2E3440"),
        cardStroke: .init("3B4252")
    )

    static let gruvboxDark = HCBColorScheme(
        id: "gruvboxDark",
        title: "Gruvbox Dark",
        isDark: true,
        ember: .init("FE8019"),
        moss: .init("B8BB26"),
        blue: .init("83A598"),
        ink: .init("EBDBB2"),
        cream: .init("282828"),
        cardStroke: .init("3C3836")
    )

    static let gruvboxLight = HCBColorScheme(
        id: "gruvboxLight",
        title: "Gruvbox Light",
        isDark: false,
        ember: .init("D65D0E"),
        moss: .init("98971A"),
        blue: .init("458588"),
        ink: .init("3C3836"),
        cream: .init("FBF1C7"),
        cardStroke: .init("D5C4A1")
    )

    static let tokyoNight = HCBColorScheme(
        id: "tokyoNight",
        title: "Tokyo Night",
        isDark: true,
        ember: .init("BB9AF7"),
        moss: .init("9ECE6A"),
        blue: .init("7DCFFF"),
        ink: .init("C0CAF5"),
        cream: .init("1A1B26"),
        cardStroke: .init("414868")
    )

    static let catppuccinMocha = HCBColorScheme(
        id: "catppuccinMocha",
        title: "Catppuccin Mocha",
        isDark: true,
        ember: .init("F5C2E7"),
        moss: .init("A6E3A1"),
        blue: .init("89B4FA"),
        ink: .init("CDD6F4"),
        cream: .init("1E1E2E"),
        cardStroke: .init("313244")
    )

    static let catppuccinLatte = HCBColorScheme(
        id: "catppuccinLatte",
        title: "Catppuccin Latte",
        isDark: false,
        ember: .init("EA76CB"),
        moss: .init("40A02B"),
        blue: .init("1E66F5"),
        ink: .init("4C4F69"),
        cream: .init("EFF1F5"),
        cardStroke: .init("BCC0CC")
    )

    static let githubLight = HCBColorScheme(
        id: "githubLight",
        title: "GitHub Light",
        isDark: false,
        ember: .init("0969DA"),
        moss: .init("1A7F37"),
        blue: .init("0969DA"),
        ink: .init("24292F"),
        cream: .init("FFFFFF"),
        cardStroke: .init("D0D7DE")
    )

    static let githubDark = HCBColorScheme(
        id: "githubDark",
        title: "GitHub Dark",
        isDark: true,
        ember: .init("58A6FF"),
        moss: .init("3FB950"),
        blue: .init("58A6FF"),
        ink: .init("C9D1D9"),
        cream: .init("0D1117"),
        cardStroke: .init("30363D")
    )

    static let ayuLight = HCBColorScheme(
        id: "ayuLight",
        title: "Ayu Light",
        isDark: false,
        ember: .init("FF6A00"),
        moss: .init("86B300"),
        blue: .init("36A3D9"),
        ink: .init("5C6773"),
        cream: .init("FAFAFA"),
        cardStroke: .init("E6E1CF")
    )

    static let ayuDark = HCBColorScheme(
        id: "ayuDark",
        title: "Ayu Dark",
        isDark: true,
        ember: .init("FFB454"),
        moss: .init("AAD94C"),
        blue: .init("59C2FF"),
        ink: .init("B3B1AD"),
        cream: .init("0F1419"),
        cardStroke: .init("1F2430")
    )

    static let materialPalenight = HCBColorScheme(
        id: "materialPalenight",
        title: "Material Palenight",
        isDark: true,
        ember: .init("C792EA"),
        moss: .init("C3E88D"),
        blue: .init("82AAFF"),
        ink: .init("A6ACCD"),
        cream: .init("292D3E"),
        cardStroke: .init("444267")
    )

    static let rosePine = HCBColorScheme(
        id: "rosePine",
        title: "Rosé Pine",
        isDark: true,
        ember: .init("EBBCBA"),
        moss: .init("9CCFD8"),
        blue: .init("C4A7E7"),
        ink: .init("E0DEF4"),
        cream: .init("191724"),
        cardStroke: .init("26233A")
    )

    static let nightOwl = HCBColorScheme(
        id: "nightOwl",
        title: "Night Owl",
        isDark: true,
        ember: .init("82AAFF"),
        moss: .init("ADDB67"),
        blue: .init("7FDBCA"),
        ink: .init("D6DEEB"),
        cream: .init("011627"),
        cardStroke: .init("1D3B53")
    )

    static let monokai = HCBColorScheme(
        id: "monokai",
        title: "Monokai",
        isDark: true,
        ember: .init("F92672"),
        moss: .init("A6E22E"),
        blue: .init("66D9EF"),
        ink: .init("F8F8F2"),
        cream: .init("272822"),
        cardStroke: .init("3E3D32")
    )

    // Order as presented in Settings: Notion first (default), HCB original
    // second, then alphabetical by title so users can scan the list.
    static let all: [HCBColorScheme] = [
        .notion,
        .hotCrossBuns,
        .ayuDark,
        .ayuLight,
        .catppuccinLatte,
        .catppuccinMocha,
        .dracula,
        .githubDark,
        .githubLight,
        .gruvboxDark,
        .gruvboxLight,
        .materialPalenight,
        .monokai,
        .nightOwl,
        .nord,
        .oneDarkPro,
        .rosePine,
        .solarizedDark,
        .solarizedLight,
        .tokyoNight
    ]

    static func scheme(id: String) -> HCBColorScheme? {
        all.first { $0.id == id }
    }
}

// Mutable current-scheme holder. Read by AppColor accessors. Updated when
// the user picks a new scheme in Settings. SwiftUI view re-evaluation is
// triggered separately via a .id(schemeID) modifier at the shell root.
//
// nonisolated(unsafe) because Color resolution can happen on any actor
// during SwiftUI's render pass. Writes only ever happen from the main
// actor (AppModel mutations), so concurrent reads see a consistent
// snapshot of a value-type struct.
enum HCBColorSchemeStore {
    nonisolated(unsafe) static var current: HCBColorScheme = .notion
}
