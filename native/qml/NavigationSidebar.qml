import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

Pane {
    id: root
    required property string currentPage
    readonly property var pageNames: ["Tasks", "Calendar", "Notes", "Settings"]
    signal pageSelected(string pageName)

    SplitView.preferredWidth: Theme.navigationWidth

    function selectPage(pageName) {
        if (pageNames.indexOf(pageName) >= 0) {
            pageSelected(pageName)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: Theme.spacingSmall

        Repeater {
            model: root.pageNames

            delegate: Button {
                required property string modelData
                Layout.fillWidth: true
                text: modelData
                checkable: true
                checked: root.currentPage === modelData
                onClicked: root.selectPage(modelData)
            }
        }

        Item { Layout.fillHeight: true }
    }
}
