import Foundation

public struct AppSettings: Codable, Equatable {
    public var paletteKeybind: String
    public var saveKeybind: String
    public var searchMode: String
    public var colorScheme: String
    public var customBackground: String
    public var customSidebar: String
    public var customAccent: String
    public var privacyLocalFirst: Bool
    public var syncAutoPull: Bool
    public var syncAutoPush: Bool
    public var historySnapshots: Bool
    public var autoCollapseSidebar: Bool
    public var mac: MacExtras

    public struct MacExtras: Codable, Equatable {
        public var schemaVersion: Int
        public var openAtLogin: Bool
        public var showMenuBarItem: Bool
        public var confirmBeforeDelete: Bool
        public var defaultNewDocLocation: String
        public var vimModeDefault: Bool
        public var uiFontFamily: String
        public var uiFontSize: Int
        public var editorFontSize: Int
        public var editorTabWidth: Int
        public var editorSoftWrap: Bool
        public var editorShowDiffGutter: Bool
        public var editorAutosaveEnabled: Bool
        public var editorAutosaveMs: Int
        public var syncMode: String
        public var auditRecheckSec: Int
        public var conflictCopyStrategy: String
        public var cacheEncryptionEnabled: Bool
        public var localBackupEnabled: Bool
        public var localBackupRetentionCount: Int
        public var historyRetentionDays: Int
        public var updaterAutoCheck: Bool
        public var updaterChannel: String
        public var lastUpdateCheckUnix: UInt64
        public var workspaceVisibilityMode: String
        public var workspaceVisibleDriveIds: [String]
        public var shortcuts: Shortcuts

        public static let `default` = MacExtras(
            schemaVersion: 1,
            openAtLogin: false,
            showMenuBarItem: false,
            confirmBeforeDelete: true,
            defaultNewDocLocation: "",
            vimModeDefault: false,
            uiFontFamily: "",
            uiFontSize: 13,
            editorFontSize: 14,
            editorTabWidth: 4,
            editorSoftWrap: true,
            editorShowDiffGutter: true,
            editorAutosaveEnabled: false,
            editorAutosaveMs: 500,
            syncMode: "balanced",
            auditRecheckSec: 60,
            conflictCopyStrategy: "suffix-iso",
            cacheEncryptionEnabled: false,
            localBackupEnabled: false,
            localBackupRetentionCount: 14,
            historyRetentionDays: 90,
            updaterAutoCheck: true,
            updaterChannel: "stable",
            lastUpdateCheckUnix: 0,
            workspaceVisibilityMode: "all",
            workspaceVisibleDriveIds: [],
            shortcuts: .default
        )

        public init(
            schemaVersion: Int,
            openAtLogin: Bool,
            showMenuBarItem: Bool,
            confirmBeforeDelete: Bool,
            defaultNewDocLocation: String,
            vimModeDefault: Bool,
            uiFontFamily: String,
            uiFontSize: Int,
            editorFontSize: Int,
            editorTabWidth: Int,
            editorSoftWrap: Bool,
            editorShowDiffGutter: Bool,
            editorAutosaveEnabled: Bool,
            editorAutosaveMs: Int,
            syncMode: String,
            auditRecheckSec: Int,
            conflictCopyStrategy: String,
            cacheEncryptionEnabled: Bool,
            localBackupEnabled: Bool,
            localBackupRetentionCount: Int,
            historyRetentionDays: Int,
            updaterAutoCheck: Bool,
            updaterChannel: String,
            lastUpdateCheckUnix: UInt64,
            workspaceVisibilityMode: String,
            workspaceVisibleDriveIds: [String],
            shortcuts: Shortcuts
        ) {
            self.schemaVersion = schemaVersion
            self.openAtLogin = openAtLogin
            self.showMenuBarItem = showMenuBarItem
            self.confirmBeforeDelete = confirmBeforeDelete
            self.defaultNewDocLocation = defaultNewDocLocation
            self.vimModeDefault = vimModeDefault
            self.uiFontFamily = uiFontFamily
            self.uiFontSize = uiFontSize
            self.editorFontSize = editorFontSize
            self.editorTabWidth = editorTabWidth
            self.editorSoftWrap = editorSoftWrap
            self.editorShowDiffGutter = editorShowDiffGutter
            self.editorAutosaveEnabled = editorAutosaveEnabled
            self.editorAutosaveMs = editorAutosaveMs
            self.syncMode = syncMode
            self.auditRecheckSec = auditRecheckSec
            self.conflictCopyStrategy = conflictCopyStrategy
            self.cacheEncryptionEnabled = cacheEncryptionEnabled
            self.localBackupEnabled = localBackupEnabled
            self.localBackupRetentionCount = localBackupRetentionCount
            self.historyRetentionDays = historyRetentionDays
            self.updaterAutoCheck = updaterAutoCheck
            self.updaterChannel = updaterChannel
            self.lastUpdateCheckUnix = lastUpdateCheckUnix
            self.workspaceVisibilityMode = workspaceVisibilityMode
            self.workspaceVisibleDriveIds = workspaceVisibleDriveIds
            self.shortcuts = shortcuts
        }

        public init(from decoder: Decoder) throws {
            let defaults = Self.default
            let container = try decoder.container(keyedBy: CodingKeys.self)
            schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion)
                ?? defaults.schemaVersion
            openAtLogin = try container.decodeIfPresent(Bool.self, forKey: .openAtLogin)
                ?? defaults.openAtLogin
            showMenuBarItem = try container.decodeIfPresent(Bool.self, forKey: .showMenuBarItem)
                ?? defaults.showMenuBarItem
            confirmBeforeDelete = try container.decodeIfPresent(Bool.self, forKey: .confirmBeforeDelete)
                ?? defaults.confirmBeforeDelete
            defaultNewDocLocation = try container.decodeIfPresent(String.self, forKey: .defaultNewDocLocation)
                ?? defaults.defaultNewDocLocation
            vimModeDefault = try container.decodeIfPresent(Bool.self, forKey: .vimModeDefault)
                ?? defaults.vimModeDefault
            uiFontFamily = try container.decodeIfPresent(String.self, forKey: .uiFontFamily)
                ?? defaults.uiFontFamily
            uiFontSize = try container.decodeIfPresent(Int.self, forKey: .uiFontSize)
                ?? defaults.uiFontSize
            editorFontSize = try container.decodeIfPresent(Int.self, forKey: .editorFontSize)
                ?? defaults.editorFontSize
            editorTabWidth = try container.decodeIfPresent(Int.self, forKey: .editorTabWidth)
                ?? defaults.editorTabWidth
            editorSoftWrap = try container.decodeIfPresent(Bool.self, forKey: .editorSoftWrap)
                ?? defaults.editorSoftWrap
            editorShowDiffGutter = try container.decodeIfPresent(Bool.self, forKey: .editorShowDiffGutter)
                ?? defaults.editorShowDiffGutter
            editorAutosaveEnabled = try container.decodeIfPresent(Bool.self, forKey: .editorAutosaveEnabled)
                ?? defaults.editorAutosaveEnabled
            editorAutosaveMs = try container.decodeIfPresent(Int.self, forKey: .editorAutosaveMs)
                ?? defaults.editorAutosaveMs
            syncMode = try container.decodeIfPresent(String.self, forKey: .syncMode)
                ?? defaults.syncMode
            auditRecheckSec = try container.decodeIfPresent(Int.self, forKey: .auditRecheckSec)
                ?? defaults.auditRecheckSec
            conflictCopyStrategy = try container.decodeIfPresent(String.self, forKey: .conflictCopyStrategy)
                ?? defaults.conflictCopyStrategy
            cacheEncryptionEnabled = try container.decodeIfPresent(Bool.self, forKey: .cacheEncryptionEnabled)
                ?? defaults.cacheEncryptionEnabled
            localBackupEnabled = try container.decodeIfPresent(Bool.self, forKey: .localBackupEnabled)
                ?? defaults.localBackupEnabled
            localBackupRetentionCount = try container.decodeIfPresent(Int.self, forKey: .localBackupRetentionCount)
                ?? defaults.localBackupRetentionCount
            historyRetentionDays = try container.decodeIfPresent(Int.self, forKey: .historyRetentionDays)
                ?? defaults.historyRetentionDays
            updaterAutoCheck = try container.decodeIfPresent(Bool.self, forKey: .updaterAutoCheck)
                ?? defaults.updaterAutoCheck
            updaterChannel = try container.decodeIfPresent(String.self, forKey: .updaterChannel)
                ?? defaults.updaterChannel
            lastUpdateCheckUnix = try container.decodeIfPresent(UInt64.self, forKey: .lastUpdateCheckUnix)
                ?? defaults.lastUpdateCheckUnix
            workspaceVisibilityMode = try container.decodeIfPresent(String.self, forKey: .workspaceVisibilityMode)
                ?? defaults.workspaceVisibilityMode
            workspaceVisibleDriveIds = try container.decodeIfPresent([String].self, forKey: .workspaceVisibleDriveIds)
                ?? defaults.workspaceVisibleDriveIds
            shortcuts = try container.decodeIfPresent(Shortcuts.self, forKey: .shortcuts)
                ?? defaults.shortcuts
            if schemaVersion < defaults.schemaVersion {
                schemaVersion = defaults.schemaVersion
            }
        }
    }

    public struct Shortcuts: Codable, Equatable {
        public var openPalette: String
        public var newDraft: String
        public var save: String
        public var push: String
        public var pull: String
        public var openSettings: String
        public var closeTab: String
        public var pane1: String
        public var pane2: String
        public var pane3: String
        public var pane4: String
        public var pane5: String

        public static let `default` = Shortcuts(
            openPalette: "cmd+p",
            newDraft: "cmd+n",
            save: "cmd+s",
            push: "cmd+shift+s",
            pull: "cmd+r",
            openSettings: "cmd+,",
            closeTab: "cmd+w",
            pane1: "cmd+1",
            pane2: "cmd+2",
            pane3: "cmd+3",
            pane4: "cmd+4",
            pane5: "cmd+5"
        )
    }

    public static let `default` = AppSettings(
        paletteKeybind: "Ctrl+P",
        saveKeybind: "Ctrl+S",
        searchMode: "Local cache first",
        colorScheme: "Default",
        customBackground: "#fbfaf7",
        customSidebar: "#f7f5f0",
        customAccent: "#3a342e",
        privacyLocalFirst: true,
        syncAutoPull: false,
        syncAutoPush: false,
        historySnapshots: true,
        autoCollapseSidebar: false,
        mac: .default
    )

    public init(
        paletteKeybind: String,
        saveKeybind: String,
        searchMode: String,
        colorScheme: String,
        customBackground: String,
        customSidebar: String,
        customAccent: String,
        privacyLocalFirst: Bool,
        syncAutoPull: Bool,
        syncAutoPush: Bool,
        historySnapshots: Bool,
        autoCollapseSidebar: Bool,
        mac: MacExtras
    ) {
        self.paletteKeybind = paletteKeybind
        self.saveKeybind = saveKeybind
        self.searchMode = searchMode
        self.colorScheme = colorScheme
        self.customBackground = customBackground
        self.customSidebar = customSidebar
        self.customAccent = customAccent
        self.privacyLocalFirst = privacyLocalFirst
        self.syncAutoPull = syncAutoPull
        self.syncAutoPush = syncAutoPush
        self.historySnapshots = historySnapshots
        self.autoCollapseSidebar = autoCollapseSidebar
        self.mac = mac
    }

    public init(from decoder: Decoder) throws {
        let defaults = Self.default
        let container = try decoder.container(keyedBy: CodingKeys.self)
        paletteKeybind = try container.decodeIfPresent(String.self, forKey: .paletteKeybind)
            ?? defaults.paletteKeybind
        saveKeybind = try container.decodeIfPresent(String.self, forKey: .saveKeybind)
            ?? defaults.saveKeybind
        searchMode = try container.decodeIfPresent(String.self, forKey: .searchMode)
            ?? defaults.searchMode
        colorScheme = try container.decodeIfPresent(String.self, forKey: .colorScheme)
            ?? defaults.colorScheme
        customBackground = try container.decodeIfPresent(String.self, forKey: .customBackground)
            ?? defaults.customBackground
        customSidebar = try container.decodeIfPresent(String.self, forKey: .customSidebar)
            ?? defaults.customSidebar
        customAccent = try container.decodeIfPresent(String.self, forKey: .customAccent)
            ?? defaults.customAccent
        privacyLocalFirst = try container.decodeIfPresent(Bool.self, forKey: .privacyLocalFirst)
            ?? defaults.privacyLocalFirst
        syncAutoPull = try container.decodeIfPresent(Bool.self, forKey: .syncAutoPull)
            ?? defaults.syncAutoPull
        syncAutoPush = try container.decodeIfPresent(Bool.self, forKey: .syncAutoPush)
            ?? defaults.syncAutoPush
        historySnapshots = try container.decodeIfPresent(Bool.self, forKey: .historySnapshots)
            ?? defaults.historySnapshots
        autoCollapseSidebar = try container.decodeIfPresent(Bool.self, forKey: .autoCollapseSidebar)
            ?? defaults.autoCollapseSidebar
        mac = try container.decodeIfPresent(MacExtras.self, forKey: .mac) ?? defaults.mac
    }
}

public enum AppSettingsSerializer {
    public static func decode(_ json: String) throws -> AppSettings {
        try JSONDecoder().decode(AppSettings.self, from: Data(json.utf8))
    }

    public static func encode(_ settings: AppSettings) -> String {
        let shared = encodeSharedBlockOnly(settings).dropLast(3)
        return """
        \(shared),
          "mac": {
            "schemaVersion": \(settings.mac.schemaVersion),
            "openAtLogin": \(bool(settings.mac.openAtLogin)),
            "showMenuBarItem": \(bool(settings.mac.showMenuBarItem)),
            "confirmBeforeDelete": \(bool(settings.mac.confirmBeforeDelete)),
            "defaultNewDocLocation": \(string(settings.mac.defaultNewDocLocation)),
            "vimModeDefault": \(bool(settings.mac.vimModeDefault)),
            "uiFontFamily": \(string(settings.mac.uiFontFamily)),
            "uiFontSize": \(settings.mac.uiFontSize),
            "editorFontSize": \(settings.mac.editorFontSize),
            "editorTabWidth": \(settings.mac.editorTabWidth),
            "editorSoftWrap": \(bool(settings.mac.editorSoftWrap)),
            "editorShowDiffGutter": \(bool(settings.mac.editorShowDiffGutter)),
            "editorAutosaveEnabled": \(bool(settings.mac.editorAutosaveEnabled)),
            "editorAutosaveMs": \(settings.mac.editorAutosaveMs),
            "syncMode": \(string(settings.mac.syncMode)),
            "auditRecheckSec": \(settings.mac.auditRecheckSec),
            "conflictCopyStrategy": \(string(settings.mac.conflictCopyStrategy)),
            "cacheEncryptionEnabled": \(bool(settings.mac.cacheEncryptionEnabled)),
            "localBackupEnabled": \(bool(settings.mac.localBackupEnabled)),
            "localBackupRetentionCount": \(settings.mac.localBackupRetentionCount),
            "historyRetentionDays": \(settings.mac.historyRetentionDays),
            "updaterAutoCheck": \(bool(settings.mac.updaterAutoCheck)),
            "updaterChannel": \(string(settings.mac.updaterChannel)),
            "lastUpdateCheckUnix": \(settings.mac.lastUpdateCheckUnix),
            "workspaceVisibilityMode": \(string(settings.mac.workspaceVisibilityMode)),
            "workspaceVisibleDriveIds": \(stringArray(settings.mac.workspaceVisibleDriveIds)),
            "shortcuts": {
              "openPalette": \(string(settings.mac.shortcuts.openPalette)),
              "newDraft": \(string(settings.mac.shortcuts.newDraft)),
              "save": \(string(settings.mac.shortcuts.save)),
              "push": \(string(settings.mac.shortcuts.push)),
              "pull": \(string(settings.mac.shortcuts.pull)),
              "openSettings": \(string(settings.mac.shortcuts.openSettings)),
              "closeTab": \(string(settings.mac.shortcuts.closeTab)),
              "pane1": \(string(settings.mac.shortcuts.pane1)),
              "pane2": \(string(settings.mac.shortcuts.pane2)),
              "pane3": \(string(settings.mac.shortcuts.pane3)),
              "pane4": \(string(settings.mac.shortcuts.pane4)),
              "pane5": \(string(settings.mac.shortcuts.pane5))
            }
          }
        }

        """
    }

    public static func encodeSharedBlockOnly(_ settings: AppSettings) -> String {
        """
        {
          "paletteKeybind": \(string(settings.paletteKeybind)),
          "saveKeybind": \(string(settings.saveKeybind)),
          "searchMode": \(string(settings.searchMode)),
          "colorScheme": \(string(settings.colorScheme)),
          "customBackground": \(string(settings.customBackground)),
          "customSidebar": \(string(settings.customSidebar)),
          "customAccent": \(string(settings.customAccent)),
          "privacyLocalFirst": \(bool(settings.privacyLocalFirst)),
          "syncAutoPull": \(bool(settings.syncAutoPull)),
          "syncAutoPush": \(bool(settings.syncAutoPush)),
          "historySnapshots": \(bool(settings.historySnapshots)),
          "autoCollapseSidebar": \(bool(settings.autoCollapseSidebar))
        }

        """
    }

    private static func bool(_ value: Bool) -> String {
        value ? "true" : "false"
    }

    private static func string(_ value: String) -> String {
        "\"\(jsonEscape(value))\""
    }

    private static func stringArray(_ values: [String]) -> String {
        "[\(values.map(string).joined(separator: ","))]"
    }

    private static func jsonEscape(_ value: String) -> String {
        var output = ""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\\":
                output += "\\\\"
            case "\"":
                output += "\\\""
            case "\n":
                output += "\\n"
            case "\r":
                output += "\\r"
            case "\t":
                output += "\\t"
            default:
                if scalar.value < 0x20 {
                    output += String(format: "\\u%04x", scalar.value)
                } else {
                    output.unicodeScalars.append(scalar)
                }
            }
        }
        return output
    }
}
