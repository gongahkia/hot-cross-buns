import QtQuick

Text {
    id: root
    property string plainText: ""
    signal linkRequested(string url)

    text: richText(plainText)
    textFormat: Text.RichText
    wrapMode: Text.WordWrap
    color: Theme.textPrimary
    linkColor: Theme.accent
    Accessible.name: plainText

    function htmlEscape(value) {
        return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;").replace(/\"/g, "&quot;")
    }

    function richText(value) {
        return htmlEscape(value).replace(/(https?:\/\/[^\s<]+)/g, "<a href=\"$1\">$1</a>")
                                .replace(/\n/g, "<br>")
    }

    MouseArea {
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: root.linkAt(mouseX, mouseY).length > 0 ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: function(mouse) {
            const link = root.linkAt(mouse.x, mouse.y)
            if (link.length > 0 && (mouse.modifiers & (Qt.MetaModifier | Qt.ControlModifier))) {
                root.linkRequested(link)
            }
        }
    }
}
