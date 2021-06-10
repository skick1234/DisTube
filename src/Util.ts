import { URL } from "url";

const formatInt = (int: number) => int < 10 ? `0${int}` : int;

/**
 * Format duration to string
 * @param {number} sec Duration in seconds
 * @returns {string}
 */
export function formatDuration(sec: number): string {
  if (!sec || !Number(sec)) return "00:00";
  const seconds = Math.floor(sec % 60);
  const minutes = Math.floor(sec % 3600 / 60);
  const hours = Math.floor(sec / 3600);
  if (hours > 0) {
    return `${formatInt(hours)}:${formatInt(minutes)}:${formatInt(seconds)}`;
  }
  if (minutes > 0) {
    return `${formatInt(minutes)}:${formatInt(seconds)}`;
  }
  return `00:${formatInt(seconds)}`;
}
/**
 * Convert formatted duration to seconds
 * @param {*} input Formatted duration string
 * @returns {number}
 */
export function toSecond(input: any): number {
  if (!input) return 0;
  if (typeof input !== "string") return Number(input) || 0;
  let h = 0, m = 0, s = 0;
  if (input.match(/:/g)) {
    const time = input.split(":");
    if (time.length === 2) {
      m = parseInt(time[0], 10);
      s = parseInt(time[1], 10);
    } else if (time.length === 3) {
      h = parseInt(time[0], 10);
      m = parseInt(time[1], 10);
      s = parseInt(time[2], 10);
    }
  } else s = parseInt(input, 10);
  return (h * 60 * 60) + (m * 60) + s;
}
/**
 * Parse number from input
 * @param {*} input Any
 * @returns {number}
 */
export function parseNumber(input: any): number {
  if (typeof input === "string") return Number(input.replace(/\D+/g, ""));
  return Number(input) || 0;
}
/**
 * Check if the string is an URL
 * @param {string} string input
 * @returns {boolean}
 */
export function isURL(string: string): boolean {
  if (string.includes(" ")) return false;
  try {
    const url = new URL(string);
    if (!["https:", "http:"].includes(url.protocol) ||
      url.origin === "null" || !url.host
    ) return false;
  } catch { return false }
  return true;
}
