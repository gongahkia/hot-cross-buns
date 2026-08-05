import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    required property string clientId
    property bool busy: false
    property string statusMessage: ""
    property string setupStatusMessage: ""
    property string statusBeforeSetupAction: ""
    property bool awaitingSetupStatus: false
    property alias clientIdField: clientIdField
    property alias saveClientIdButton: saveClientIdButton
    property alias connectGoogleButton: connectGoogleButton
    property alias statusLabel: statusLabel
    signal saveClientIdRequested(string clientId)
    signal connectGoogleRequested()

    function awaitSetupStatus() {
        statusBeforeSetupAction = statusMessage
        setupStatusMessage = ""
        awaitingSetupStatus = true
    }

    onStatusMessageChanged: {
        if (awaitingSetupStatus && statusMessage !== statusBeforeSetupAction) {
            setupStatusMessage = statusMessage
            awaitingSetupStatus = false
        }
    }

    Flickable {
        anchors.fill: parent
        contentWidth: width
        contentHeight: onboardingContent.implicitHeight
        boundsBehavior: Flickable.StopAtBounds
        clip: true

        ScrollBar.vertical: ScrollBar {
            policy: parent.contentHeight > parent.height ? ScrollBar.AsNeeded : ScrollBar.AlwaysOff
        }

        ColumnLayout {
            id: onboardingContent
            anchors.horizontalCenter: parent.horizontalCenter
            width: Math.min(parent.width - Theme.spacingLarge * 2, 560)
            spacing: Theme.spacingLarge

            Item { Layout.preferredHeight: Theme.spacingLarge * 3 }

            Label {
                Layout.fillWidth: true
                text: "Welcome to Hot Cross Buns"
                font.pixelSize: Theme.titleFontSize
                horizontalAlignment: Text.AlignHCenter
                Accessible.role: Accessible.Heading
                Accessible.name: text
            }

            Label {
                Layout.fillWidth: true
                text: "Connect Google to bring your Tasks and Calendar into one place."
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                color: Theme.textSecondary
            }

            Frame {
                Layout.fillWidth: true

                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingSmall

                    Label {
                        text: "1. Prepare Google Cloud"
                        font.pixelSize: Theme.labelFontSize
                        font.bold: true
                        Accessible.role: Accessible.Heading
                        Accessible.name: text
                    }

                    Label {
                        Layout.fillWidth: true
                        text: "Configure OAuth consent, enable Google Tasks, Google Calendar, and Google Drive APIs, then create a Desktop app OAuth client."
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }
                }
            }

            Frame {
                Layout.fillWidth: true

                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingMedium

                    Label {
                        text: "2. Add your client ID"
                        font.pixelSize: Theme.labelFontSize
                        font.bold: true
                        Accessible.role: Accessible.Heading
                        Accessible.name: text
                    }

                    Label {
                        Layout.fillWidth: true
                        text: "Paste only the client ID. Do not paste or share the downloaded client secret."
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    TextField {
                        id: clientIdField
                        Layout.fillWidth: true
                        text: root.clientId
                        placeholderText: "Desktop OAuth client ID"
                        Accessible.name: placeholderText
                        selectByMouse: true
                    }

                    Button {
                        id: saveClientIdButton
                        text: "Save client ID"
                        enabled: clientIdField.text.trim().length > 0 && !root.busy
                        Accessible.name: text
                        onClicked: {
                            root.awaitSetupStatus()
                            root.saveClientIdRequested(clientIdField.text)
                        }
                    }
                }
            }

            Frame {
                Layout.fillWidth: true

                ColumnLayout {
                    anchors.fill: parent
                    spacing: Theme.spacingMedium

                    Label {
                        text: "3. Connect Google"
                        font.pixelSize: Theme.labelFontSize
                        font.bold: true
                        Accessible.role: Accessible.Heading
                        Accessible.name: text
                    }

                    Label {
                        Layout.fillWidth: true
                        text: "After saving, continue in your browser. Hot Cross Buns uses a temporary local callback to finish connecting."
                        wrapMode: Text.WordWrap
                        color: Theme.textSecondary
                    }

                    Button {
                        id: connectGoogleButton
                        text: "Connect Google"
                        enabled: root.clientId.trim().length > 0 && !root.busy
                        Accessible.name: text
                        onClicked: {
                            root.awaitSetupStatus()
                            root.connectGoogleRequested()
                        }
                    }
                }
            }

            Label {
                id: statusLabel
                Layout.fillWidth: true
                visible: root.setupStatusMessage.length > 0
                text: root.setupStatusMessage
                wrapMode: Text.WordWrap
                color: Theme.textSecondary
                Accessible.name: text
            }

            Item { Layout.preferredHeight: Theme.spacingLarge * 3 }
        }
    }
}
