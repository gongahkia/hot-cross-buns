import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Dialog {
    id: root
    default property alias body: bodyLayout.data
    property string primaryText: "Save"
    property string secondaryText: "Cancel"
    property bool primaryDestructive: false
    property alias primaryButton: primaryButton
    property alias secondaryButton: secondaryButton
    signal primaryAction()
    signal secondaryAction()

    modal: true
    focus: true
    padding: Theme.spacingLarge
    closePolicy: Popup.CloseOnEscape
    width: Math.min(520, parent ? parent.width - Theme.spacingLarge * 2 : 520)

    header: Label {
        text: root.title
        visible: text.length > 0
        padding: Theme.spacingLarge
        font.bold: true
        font.pixelSize: Theme.labelFontSize
        Accessible.role: Accessible.Heading
        Accessible.name: text
    }

    contentItem: ColumnLayout {
        id: bodyLayout
        spacing: Theme.spacingMedium
    }

    footer: DialogButtonBox {
        padding: Theme.spacingLarge

        Button {
            id: secondaryButton
            text: root.secondaryText
            Accessible.name: text
            onClicked: {
                root.secondaryAction()
                root.reject()
            }
        }

        Item { Layout.fillWidth: true }

        Button {
            id: primaryButton
            text: root.primaryText
            Accessible.name: text
            Accessible.description: root.primaryDestructive ? "Destructive action" : "Primary action"
            palette.button: root.primaryDestructive ? Theme.destructive : Theme.accent
            onClicked: {
                root.primaryAction()
                root.accept()
            }
        }
    }
}
