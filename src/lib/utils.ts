import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class combiner — kept because `components.json` points at it. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
