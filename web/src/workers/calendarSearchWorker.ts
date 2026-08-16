/// <reference lib="webworker" />

import {
  type CalendarSearchDocument,
  searchCalendarHistory
} from "@/features/calendarSearch";
import type { PaletteFilters } from "@/features/paletteFilters";

interface IndexRequest {
  readonly type: "index";
  readonly generation: number;
  readonly documents: readonly CalendarSearchDocument[];
}

interface SearchRequest {
  readonly type: "search";
  readonly requestId: number;
  readonly query: string;
  readonly includeBody: boolean;
  readonly filters: PaletteFilters;
  readonly calendarNames: Readonly<Record<string, string>>;
}

let documents: readonly CalendarSearchDocument[] = [];

self.onmessage = (event: MessageEvent<IndexRequest | SearchRequest>) => {
  const request = event.data;
  if (request.type === "index") {
    documents = request.documents;
    self.postMessage({ type: "indexed", generation: request.generation });
    return;
  }
  self.postMessage({
    type: "results",
    requestId: request.requestId,
    hits: searchCalendarHistory(documents, request.query, request.includeBody, 24, request.filters, request.calendarNames)
  });
};

export {};
