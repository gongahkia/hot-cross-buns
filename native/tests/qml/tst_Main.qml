import QtQuick
import QtTest

TestCase {
    id: testCase
    name: "Main"
    when: windowShown

    property var startedTransitions: []
    property var completedTransitions: []

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

    function test_usesDesignTokens() {
        const component = Qt.createComponent("../../qml/Main.qml")
        compare(component.status, Component.Ready, component.errorString())

        const mainWindow = component.createObject(null)
        verify(mainWindow !== null)
        compare(mainWindow.color.toString(), "#17191d")
        compare(mainWindow.palette.window.toString(), "#17191d")
        compare(mainWindow.palette.base.toString(), "#20242a")
        compare(mainWindow.palette.highlight.toString(), "#e88747")
        mainWindow.destroy()
    }
}
