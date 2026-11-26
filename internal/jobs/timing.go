package jobs

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

func (d Definition) Timing() string {
	text := d.timingRule()
	location, err := time.LoadLocation(d.Timezone)
	if err != nil {
		return text
	}
	if !d.StartsAt.IsZero() {
		text += " · starting " + d.StartsAt.In(location).Format("Jan 2, 2006 at 3:04 PM")
	}
	if !d.EndsAt.IsZero() {
		text += " · until " + d.EndsAt.In(location).Format("Jan 2, 2006 at 3:04 PM") + " (exclusive)"
	}
	return text
}

func (d Definition) timingRule() string {
	zone := d.Timezone
	if zone == "Local" {
		zone = "device time"
	}
	if !d.RunAt.IsZero() {
		location, err := time.LoadLocation(d.Timezone)
		if err != nil {
			return "One-time task · time zone needs attention"
		}
		return "Once on " + d.RunAt.In(location).Format("January 2, 2006 at 3:04 PM") + " · " + zone
	}
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	parsed, err := parser.Parse(d.Schedule)
	if err != nil {
		return "Schedule needs attention"
	}
	spec, ok := parsed.(*cron.SpecSchedule)
	if !ok {
		return "Recurring task · " + zone
	}
	minutes, hours := maskValues(spec.Minute, 0, 59), maskValues(spec.Hour, 0, 23)
	clock := "At selected times"
	if len(hours) == 24 && len(minutes) == 60 {
		clock = "Every minute"
	} else if len(hours) == 24 && evenlySpaced(minutes, 60) > 1 {
		clock = fmt.Sprintf("Every %d minutes", evenlySpaced(minutes, 60))
	} else if len(hours) == 24 && len(minutes) == 1 {
		clock = fmt.Sprintf("Every hour at %d minutes past", minutes[0])
	} else if len(minutes)*len(hours) <= 8 {
		var times []string
		for _, hour := range hours {
			for _, minute := range minutes {
				times = append(times, time.Date(2000, 1, 1, hour, minute, 0, 0, time.UTC).Format("3:04 PM"))
			}
		}
		clock = "At " + strings.Join(times, ", ")
	} else {
		clock = "At hours " + numberWords(hours) + ", minutes " + numberWords(minutes)
	}
	days, weekdays, months := maskValues(spec.Dom, 1, 31), maskValues(spec.Dow, 0, 6), maskValues(spec.Month, 1, 12)
	day := "every day"
	domStar, dowStar := spec.Dom&(uint64(1)<<63) != 0, spec.Dow&(uint64(1)<<63) != 0
	if len(days) < 31 && len(weekdays) < 7 {
		join := " or "
		if domStar || dowStar {
			join = " that fall on "
		}
		day = "on dates " + numberWords(days) + join + weekdayWords(weekdays)
	} else if len(days) < 31 && dowStar {
		day = "on day " + numberWords(days) + " of the month"
	} else if len(weekdays) < 7 && domStar {
		day = "every " + weekdayWords(weekdays)
	}
	if len(months) < 12 {
		var names []string
		for _, month := range months {
			names = append(names, time.Month(month).String())
		}
		day += " in " + strings.Join(names, ", ")
	}
	return clock + ", " + day + " · " + zone
}

// Upcoming returns actual eligible occurrences, using the same bounds as Due.
func (d Definition) Upcoming(after time.Time, count int) ([]time.Time, error) {
	if count < 1 || count > 10 {
		return nil, fmt.Errorf("preview 1–10 upcoming executions")
	}
	s, err := Schedule(d)
	if err != nil {
		return nil, err
	}
	result := []time.Time{}
	for range count {
		next := s.Next(after)
		if next.IsZero() {
			break
		}
		result = append(result, next)
		after = next
	}
	return result, nil
}

func maskValues(mask uint64, low, high int) []int {
	var result []int
	for n := low; n <= high; n++ {
		if mask&(uint64(1)<<n) != 0 {
			result = append(result, n)
		}
	}
	return result
}
func numberWords(values []int) string {
	var words []string
	for _, value := range values {
		words = append(words, strconv.Itoa(value))
	}
	return strings.Join(words, ", ")
}
func evenlySpaced(values []int, limit int) int {
	if len(values) < 2 || values[0] != 0 {
		return 0
	}
	step := values[1]
	if step < 1 || limit%step != 0 || len(values) != limit/step {
		return 0
	}
	for i, value := range values {
		if value != i*step {
			return 0
		}
	}
	return step
}
func weekdayWords(values []int) string {
	if fmt.Sprint(values) == "[1 2 3 4 5]" {
		return "weekday"
	}
	if fmt.Sprint(values) == "[0 6]" {
		return "Saturday and Sunday"
	}
	var names []string
	for _, value := range values {
		names = append(names, time.Weekday(value).String())
	}
	return strings.Join(names, ", ")
}

func (d Definition) ScheduleKind() string {
	if !d.RunAt.IsZero() {
		return "once"
	}
	return "recurring"
}
