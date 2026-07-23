import QtQuick
import QtTest

TestCase {
    id: testCase
    name: "Main"
    when: windowShown

    property var startedTransitions: []
    property var completedTransitions: []

    SystemPalette {
        id: systemPalette
        colorGroup: SystemPalette.Active
    }

    function begin(name) {
        startedTransitions.push(name)
        return true
    }

    function complete(name) {
        completedTransitions.push(name)
        return true
    }

    function test_loadsApplicationWindow() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null)
        verify(mainWindow !== null)
        compare(mainWindow.title, "Hot Cross Buns")
        compare(mainWindow.width, 1200)
        compare(mainWindow.height, 760)
        compare(mainWindow.minimumWidth, 900)
        compare(mainWindow.minimumHeight, 600)
        mainWindow.destroy()
    }

    function test_recordsSidebarTransition() {
        startedTransitions = []
        completedTransitions = []
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { transitionTimings: testCase })
        verify(mainWindow !== null)
        mainWindow.selectPage("Calendar")
        compare(mainWindow.currentPage, "Calendar")
        compare(startedTransitions, ["navigation.calendar"])
        tryVerify(function() {
            return completedTransitions.length === 1
        })
        compare(completedTransitions, ["navigation.calendar"])
        mainWindow.destroy()
    }

    function test_sidebarRoutesSelectionThroughWindow() {
        startedTransitions = []
        completedTransitions = []
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null, { transitionTimings: testCase })
        verify(mainWindow !== null)
        compare(mainWindow.navigationSidebar.currentPage, "Tasks")
        compare(mainWindow.navigationSidebar.pageNames.length, 4)
        mainWindow.navigationSidebar.selectPage("Unsupported")
        compare(mainWindow.currentPage, "Tasks")
        compare(startedTransitions, [])
        mainWindow.navigationSidebar.selectPage("Notes")
        compare(mainWindow.currentPage, "Notes")
        compare(mainWindow.navigationSidebar.currentPage, "Notes")
        compare(startedTransitions, ["navigation.notes"])
        tryVerify(function() {
            return completedTransitions.length === 1
        })
        compare(completedTransitions, ["navigation.notes"])
        mainWindow.destroy()
    }

    function test_usesDesignTokens() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null)
        verify(mainWindow !== null)
        compare(mainWindow.color.toString(), systemPalette.window.toString())
        compare(mainWindow.palette.window.toString(), systemPalette.window.toString())
        compare(mainWindow.palette.base.toString(), systemPalette.base.toString())
        compare(mainWindow.palette.highlight.toString(), systemPalette.highlight.toString())
        mainWindow.destroy()
    }

    function test_accessibleButtonExposesLabelAndPressAction() {
        const component = Qt.createComponent("../../qml/AccessibleButton.qml")
        compare(component.status, Component.Ready, component.errorString())

        const button = component.createObject(null, { text: "Save" })
        verify(button !== null)
        compare(button.accessibleName, "")
        compare(button.Accessible.name, "Save")
        compare(button.Accessible.role, Accessible.Button)
        verify(button.Accessible.focusable)
        button.accessibleName = "Save draft"
        compare(button.Accessible.name, "Save draft")
        button.destroy()
    }

    function test_accessibleNavigationButtonRoutesSelection() {
        const component = Qt.createComponent("../../qml/AccessibleNavigationButton.qml")
        compare(component.status, Component.Ready, component.errorString())

        const button = component.createObject(null, { pageName: "Notes", currentPage: true })
        verify(button !== null)
        let selectedPage = ""
        button.pageSelected.connect(function(pageName) {
            selectedPage = pageName
        })
        compare(button.text, "Notes")
        verify(button.checkable)
        verify(button.checked)
        compare(button.Accessible.name, "Notes")
        compare(button.Accessible.role, Accessible.PageTab)
        verify(button.Accessible.checkable)
        verify(button.Accessible.checked)
        button.click()
        compare(selectedPage, "Notes")
        button.destroy()
    }
}
