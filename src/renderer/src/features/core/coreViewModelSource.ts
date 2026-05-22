import {
  calendarAgendaEvents,
  calendarDayView,
  calendarEventsById,
  calendarMonthWeeks,
  calendarWeekDays,
  getPrecomputedSearchViewModel,
  getTaskById,
  getTaskFilterViewModel,
  initialNotes,
  largeTaskWindow,
  settingsSections,
  taskFilterViewModels,
  todayViewModel
} from "./mockCoreViewModels";
import type {
  CalendarDayViewModel,
  CalendarEventViewModel,
  CalendarMonthWeekViewModel,
  NoteViewModel,
  SearchViewModel,
  SettingsSectionViewModel,
  TaskFilterId,
  TaskFilterViewModel,
  TaskViewModel
} from "./coreViewModels";

export interface CoreViewModelSource {
  calendarAgendaEvents: CalendarEventViewModel[];
  calendarDayView: CalendarDayViewModel;
  calendarEventsById: Record<string, CalendarEventViewModel>;
  calendarMonthWeeks: CalendarMonthWeekViewModel[];
  calendarWeekDays: CalendarDayViewModel[];
  getSearchViewModel: (query: string) => SearchViewModel;
  getTaskById: (taskId: string) => TaskViewModel;
  getTaskFilterViewModel: (filterId: TaskFilterId) => TaskFilterViewModel;
  initialNotes: NoteViewModel[];
  largeTaskWindow: TaskViewModel[];
  settingsSections: SettingsSectionViewModel[];
  taskFilterViewModels: TaskFilterViewModel[];
  todayViewModel: typeof todayViewModel;
}

const mockCoreViewModelSource: CoreViewModelSource = {
  calendarAgendaEvents,
  calendarDayView,
  calendarEventsById,
  calendarMonthWeeks,
  calendarWeekDays,
  getSearchViewModel: getPrecomputedSearchViewModel,
  getTaskById,
  getTaskFilterViewModel,
  initialNotes,
  largeTaskWindow,
  settingsSections,
  taskFilterViewModels,
  todayViewModel
};

export function useCoreViewModelSource(): CoreViewModelSource {
  return mockCoreViewModelSource;
}
