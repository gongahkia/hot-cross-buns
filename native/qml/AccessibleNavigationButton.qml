import QtQuick

AccessibleButton {
    id: root
    required property string pageName
    required property bool currentPage
    signal pageSelected(string pageName)

    text: pageName
    checkable: true
    checked: currentPage
    accessibleDescription: currentPage ? pageName + " page, selected" : pageName + " page"
    Accessible.role: Accessible.PageTab
    Accessible.checkable: true
    Accessible.checked: root.checked
    onClicked: pageSelected(pageName)
}
