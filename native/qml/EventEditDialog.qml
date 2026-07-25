import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Edit event"
    primaryText: "Save event"
    primaryEnabled: eventId.length > 0 && eventCalendarId.length > 0 &&
                    titleField.text.trim().length > 0 && validRange()
    property var calendarSourceModel: null
    property string eventId: ""
    property string eventCalendarId: ""
    property alias eventTitle: titleField.text
    property alias eventStartAt: startField.text
    property alias eventEndAt: endField.text
    property alias eventAllDay: allDayCheck.checked
    property alias eventDescription: descriptionField.text
    property alias eventLocation: locationField.text
    property alias calendarPicker: calendarPicker
    property alias eventTitleField: titleField
    signal eventUpdateRequested(string eventId, string calendarId, string title, string startAt,
                                string endAt, bool allDay, string description, string location)

    function validRange() {
        const start = Date.parse(startField.text)
        const end = Date.parse(endField.text)
        return Number.isFinite(start) && Number.isFinite(end) && end > start
    }

    function openForEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location) {
        root.eventId = eventId
        eventCalendarId = calendarId
        titleField.text = title
        startField.text = startAt
        endField.text = endAt
        allDayCheck.checked = allDay
        descriptionField.text = description
        locationField.text = location
        calendarPicker.currentIndex = calendarPicker.indexOfValue(calendarId)
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: eventUpdateRequested(eventId, eventCalendarId, titleField.text.trim(),
                                          startField.text, endField.text, allDayCheck.checked,
                                          descriptionField.text, locationField.text)

    TextField {
        id: titleField
        Layout.fillWidth: true
        placeholderText: "Event title"
        Accessible.name: "Event title"
        selectByMouse: true
        Keys.onReturnPressed: {
            if (root.primaryEnabled) {
                root.primaryButton.click()
            }
        }
    }

    ComboBox {
        id: calendarPicker
        Layout.fillWidth: true
        model: root.calendarSourceModel
        textRole: "title"
        valueRole: "id"
        Accessible.name: "Event calendar"
        onCurrentValueChanged: root.eventCalendarId = currentValue || ""
    }

    CheckBox {
        id: allDayCheck
        text: "All day"
        Accessible.name: text
    }

    TextField {
        id: startField
        Layout.fillWidth: true
        placeholderText: "Start (ISO 8601)"
        Accessible.name: "Event starts"
        selectByMouse: true
    }

    TextField {
        id: endField
        Layout.fillWidth: true
        placeholderText: "End (ISO 8601)"
        Accessible.name: "Event ends"
        selectByMouse: true
    }

    TextField {
        id: locationField
        Layout.fillWidth: true
        placeholderText: "Location"
        Accessible.name: "Event location"
        selectByMouse: true
    }

    TextArea {
        id: descriptionField
        Layout.fillWidth: true
        Layout.preferredHeight: 160
        placeholderText: "Description"
        Accessible.name: "Event description"
        selectByMouse: true
        wrapMode: TextEdit.Wrap
    }
}
