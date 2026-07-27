import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

HcbDialog {
    id: root
    title: "Edit event"
    primaryText: "Save event"
    primaryEnabled: eventId.length > 0 && eventCalendarId.length > 0 &&
                    titleField.text.trim().length > 0 && validRange() && validMetadata()
    property var calendarSourceModel: null
    property string eventId: ""
    property string eventCalendarId: ""
    property string recurrenceRule: ""
    property string recurringRemoteId: ""
    property string originalStartAt: ""
    property alias eventTitle: titleField.text
    property alias eventStartAt: startField.text
    property alias eventEndAt: endField.text
    property alias eventAllDay: allDayCheck.checked
    property alias eventDescription: descriptionField.text
    property alias eventLocation: locationField.text
    property alias eventTimeZone: timeZoneField.text
    property alias eventColorId: colorIdField.text
    property alias calendarPicker: calendarPicker
    property alias eventTitleField: titleField
    property alias deleteButton: deleteButton
    signal eventUpdateRequested(string eventId, string calendarId, string title, string startAt,
                                string endAt, bool allDay, string description, string location,
                                string timeZone, string colorId, bool available, string visibility,
                                var attendees, bool remindersUseDefault, var reminders,
                                string recurrenceRule, int recurrenceScope)
    signal eventDeleteRequested(string eventId, string title, string recurrenceRule,
                                string recurringRemoteId, string originalStartAt)

    function recurrenceScopeOptions() {
        if (recurringRemoteId.length > 0) {
            return [{ text: "This instance", value: 0 },
                    { text: "This and following", value: 1 },
                    { text: "Entire series", value: 2 }]
        }
        if (recurrenceRule.length > 0 && originalStartAt.length > 0) {
            return [{ text: "This instance", value: 0 },
                    { text: "This and following", value: 1 },
                    { text: "Entire series", value: 2 }]
        }
        if (recurrenceRule.length > 0) return [{ text: "Entire series", value: 2 }]
        return [{ text: "This event", value: 0 }]
    }

    function validRange() {
        const start = Date.parse(startField.text)
        const end = Date.parse(endField.text)
        return Number.isFinite(start) && Number.isFinite(end) && end > start
    }

    function attendeeValues() {
        const seen = {}
        const values = attendeeField.text.split(/[\n,;]/).map(function(value) { return value.trim() })
            .filter(function(value) { return value.length > 0 })
        for (let index = 0; index < values.length; ++index) {
            const value = values[index]
            const key = value.toLowerCase()
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || seen[key]) return null
            seen[key] = true
        }
        return values.length <= 200 ? values : null
    }

    function reminderValues() {
        const text = reminderField.text.trim()
        if (text.length === 0) return []
        const values = text.split(/[\n,;]/).map(function(value) { return value.trim() })
            .filter(function(value) { return value.length > 0 })
        const reminders = []
        for (let index = 0; index < values.length; ++index) {
            const match = /^(email|popup)\s*:\s*(\d+)$/.exec(values[index])
            if (match === null) return null
            const minutes = Number(match[2])
            if (!Number.isInteger(minutes) || minutes < 0 || minutes > 40320) return null
            reminders.push({ method: match[1], minutes: minutes })
        }
        return reminders.length <= 5 ? reminders : null
    }

    function validMetadata() {
        return attendeeValues() !== null && reminderValues() !== null &&
               (timeZoneField.text.trim().length === 0 ||
                /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_+-]+)+)$/.test(timeZoneField.text.trim()))
    }

    function recurrenceSummary() {
        const match = /(?:^|\n)RRULE:([^\n]+)/.exec(recurrenceRuleField.text.trim())
        if (match === null) return ""
        const frequency = /(?:^|;)FREQ=([A-Z]+)(?:;|$)/.exec(match[1])
        const interval = /(?:^|;)INTERVAL=(\d+)(?:;|$)/.exec(match[1])
        if (frequency === null) return "Google will validate this recurrence rule"
        const unit = frequency[1].toLowerCase().slice(0, -2)
        return interval !== null && interval[1] !== "1" ? "Repeats every " + interval[1] + " " + unit + "s"
                                                         : "Repeats " + unit + "ly"
    }

    function csvFromJson(json) {
        try {
            return JSON.parse(json).join(", ")
        } catch (error) {
            return ""
        }
    }

    function remindersFromJson(json) {
        try {
            return JSON.parse(json).map(function(reminder) {
                return reminder.method + ":" + reminder.minutes
            }).join(", ")
        } catch (error) {
            return ""
        }
    }

    function openForEdit(eventId, calendarId, title, startAt, endAt, allDay, description, location,
                         startTimeZone, colorId, transparency, visibility, attendeeEmailsJson,
                         remindersJson, remindersUseDefault, recurrenceRule, recurringRemoteId,
                         originalStartAt) {
        root.eventId = eventId
        eventCalendarId = calendarId
        titleField.text = title
        startField.text = startAt
        endField.text = endAt
        allDayCheck.checked = allDay
        descriptionField.text = description
        locationField.text = location
        timeZoneField.text = startTimeZone || ""
        colorIdField.text = colorId || ""
        availableCheck.checked = transparency === "transparent"
        visibilityPicker.currentIndex = visibilityPicker.indexOfValue(visibility || "default")
        attendeeField.text = csvFromJson(attendeeEmailsJson || "[]")
        reminderField.text = remindersFromJson(remindersJson || "[]")
        defaultRemindersCheck.checked = remindersUseDefault === undefined ? true : remindersUseDefault
        root.recurrenceRule = recurrenceRule || ""
        root.recurringRemoteId = recurringRemoteId || ""
        root.originalStartAt = originalStartAt || ""
        recurrenceRuleField.text = root.recurrenceRule
        recurrencePresetPicker.currentIndex = 0
        recurrenceScopePicker.model = recurrenceScopeOptions()
        recurrenceScopePicker.currentIndex = 0
        calendarPicker.currentIndex = calendarPicker.indexOfValue(calendarId)
        open()
    }

    onOpened: titleField.forceActiveFocus()
    onPrimaryAction: eventUpdateRequested(eventId, eventCalendarId, titleField.text.trim(),
                                          startField.text, endField.text, allDayCheck.checked,
                                          descriptionField.text, locationField.text,
                                          timeZoneField.text.trim(), colorIdField.text.trim(),
                                          availableCheck.checked, visibilityPicker.currentValue,
                                          attendeeValues(), defaultRemindersCheck.checked,
                                          reminderValues(), recurrenceRuleField.text,
                                          recurrenceScopePicker.currentValue)

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

    TextField {
        id: timeZoneField
        Layout.fillWidth: true
        placeholderText: "Time zone (IANA, optional)"
        Accessible.name: "Event time zone"
        selectByMouse: true
    }

    TextField {
        id: colorIdField
        Layout.fillWidth: true
        placeholderText: "Google color ID (optional)"
        Accessible.name: "Event color"
        selectByMouse: true
    }

    CheckBox {
        id: availableCheck
        text: "Show as available"
        Accessible.name: text
    }

    ComboBox {
        id: visibilityPicker
        Layout.fillWidth: true
        model: [{ text: "Default", value: "default" }, { text: "Public", value: "public" },
                { text: "Private", value: "private" }, { text: "Confidential", value: "confidential" }]
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Event visibility"
    }

    TextField {
        id: attendeeField
        Layout.fillWidth: true
        placeholderText: "Guests (comma-separated email addresses)"
        Accessible.name: "Event guests"
        selectByMouse: true
    }

    CheckBox {
        id: defaultRemindersCheck
        text: "Use calendar default reminders"
        Accessible.name: text
    }

    TextField {
        id: reminderField
        Layout.fillWidth: true
        enabled: !defaultRemindersCheck.checked
        placeholderText: "Custom reminders, e.g. popup:10, email:60"
        Accessible.name: "Event custom reminders"
        selectByMouse: true
    }

    ComboBox {
        id: recurrencePresetPicker
        Layout.fillWidth: true
        enabled: root.recurringRemoteId.length === 0
        model: [{ text: "Custom / none", value: "" },
                { text: "Daily", value: "RRULE:FREQ=DAILY" },
                { text: "Weekdays", value: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
                { text: "Weekly", value: "RRULE:FREQ=WEEKLY" },
                { text: "Monthly", value: "RRULE:FREQ=MONTHLY" },
                { text: "Yearly", value: "RRULE:FREQ=YEARLY" }]
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Recurrence preset"
        onActivated: {
            if (currentValue.length > 0) recurrenceRuleField.text = currentValue
        }
    }

    TextArea {
        id: recurrenceRuleField
        Layout.fillWidth: true
        Layout.preferredHeight: 84
        enabled: root.recurringRemoteId.length === 0
        placeholderText: "Repeat rule, e.g. RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"
        Accessible.name: "Event recurrence rule"
        Accessible.description: enabled ? "Google Calendar RFC 5545 lines; presets replace this text"
                                      : "Individual instances inherit their series rule"
        selectByMouse: true
        wrapMode: TextEdit.Wrap
    }

    Label {
        Layout.fillWidth: true
        visible: root.recurrenceSummary().length > 0
        text: root.recurrenceSummary()
        color: Theme.textSecondary
        wrapMode: Text.WordWrap
        Accessible.name: "Recurrence summary: " + text
    }

    ComboBox {
        id: recurrenceScopePicker
        Layout.fillWidth: true
        visible: root.recurrenceRule.length > 0 || root.recurringRemoteId.length > 0
        model: root.recurrenceScopeOptions()
        textRole: "text"
        valueRole: "value"
        Accessible.name: "Recurrence edit scope"
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

    Button {
        id: deleteButton
        text: "Delete event"
        Layout.alignment: Qt.AlignRight
        palette.button: Theme.destructive
        Accessible.name: text
        Accessible.description: "Delete this event"
        onClicked: {
            root.close()
            root.eventDeleteRequested(root.eventId, titleField.text, root.recurrenceRule,
                                      root.recurringRemoteId, root.originalStartAt)
        }
    }
}
