import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Shared shadcn-compatible class composition helper. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
