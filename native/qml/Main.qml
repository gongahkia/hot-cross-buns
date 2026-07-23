import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: window
    width: 1200
    height: 760
    minimumWidth: 900
    minimumHeight: 600
    visible: true
    title: "Hot Cross Buns"
    property string currentPage: "Tasks"
    property var transitionTimings: null

    function selectPage(pageName) {
        if (pageName === currentPage) {
            return
        }
        const spanName = "navigation." + pageName.toLowerCase()
        const tracked = transitionTimings !== null && transitionTimings.begin(spanName)
        currentPage = pageName
        if (tracked) {
            Qt.callLater(function() {
                transitionTimings.complete(spanName)
            })
        }
    }

    palette.window: "#17191d"
    palette.windowText: "#f2f2f2"
    palette.base: "#20242a"
    palette.text: "#f2f2f2"
    palette.highlight: "#e88747"

    header: ToolBar {
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: 16
            anchors.rightMargin: 16

            Label {
                text: "Hot Cross Buns"
                font.bold: true
                font.pixelSize: 16
            }
            Item { Layout.fillWidth: true }
            Label {
                text: "Native rewrite foundation"
                opacity: 0.7
            }
        }
    }

    SplitView {
        anchors.fill: parent

        Pane {
            SplitView.preferredWidth: 220
            ColumnLayout {
                anchors.fill: parent
                spacing: 8
                Repeater {
                    model: ["Tasks", "Calendar", "Notes", "Settings"]
                    delegate: Button {
                        required property string modelData
                        Layout.fillWidth: true
                        text: modelData
                        checkable: true
                        checked: window.currentPage === modelData
                        onClicked: window.selectPage(modelData)
                    }
                }
                Item { Layout.fillHeight: true }
            }
        }

        Pane {
            SplitView.fillWidth: true
            ColumnLayout {
                anchors.fill: parent
                spacing: 12
                Label {
                    text: window.currentPage
                    font.pixelSize: 20
                }
                Label {
                    text: "Qt Quick presents small C++ model diffs; sync, search, recurrence, and SQLite stay off the UI thread."
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    opacity: 0.72
                }
                Item { Layout.fillHeight: true }
            }
        }
    }
}
