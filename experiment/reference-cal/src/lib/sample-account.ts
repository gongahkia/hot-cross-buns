import type { CalendarAccount } from "@/components/week-view-types";

/** Temporary data source; account/calendar UI receives these records via props. */
export const SAMPLE_ACCOUNT_EMAIL = "angryapplegravy@gmail.com";

export const SAMPLE_ACCOUNTS: CalendarAccount[] = [
  {
    email: SAMPLE_ACCOUNT_EMAIL,
    calendars: [
      {
        id: SAMPLE_ACCOUNT_EMAIL,
        name: SAMPLE_ACCOUNT_EMAIL,
        color: "red",
        visible: true,
      },
      { id: "Personal", name: "Personal", color: "purple", visible: true },
      { id: "Work", name: "Work", color: "blue", visible: true },
      { id: "Family", name: "Family", color: "orange", visible: true },
      {
        id: "Side Projects",
        name: "Side Projects",
        color: "yellow",
        visible: true,
      },
      { id: "Fitness", name: "Fitness", color: "green", visible: true },
    ],
  },
];
