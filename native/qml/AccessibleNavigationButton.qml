import QtQuick

AccessibleButton {
    id: root
    required property string pageName
    required property bool currentPage
    property string badgeText: ""
    signal pageSelected(string pageName)

    text: pageName + (badgeText.length > 0 ? " (" + badgeText + ")" : "")
    checkable: true
    checked: currentPage && enabled
    accessibleDescription: !enabled ? pageName + " page, connect Google to use"
                                    : currentPage ? pageName + " page, selected" : pageName + " page"
    Accessible.role: Accessible.PageTab
    Accessible.checkable: true
    Accessible.checked: root.checked
    onClicked: pageSelected(pageName)
}
