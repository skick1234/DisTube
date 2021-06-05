const formatInt = int => int < 10 ? `0${int}` : int;

/** DisTube's Util */
class Util {
  /**
   * Format duration to string
   * @param {number} sec Duration in seconds
   * @returns {string}
   */
  static formatDuration(sec) {
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
   * @param {string} string Formatted duration string
   * @returns {number}
   */
  static toSecond(string) {
    if (!string) return 0;
    if (typeof string !== "string") return parseInt(string) || 0;
    let h = 0, m = 0, s = 0;
    if (string.match(/:/g)) {
      const time = string.split(":");
      if (time.length === 2) {
        m = parseInt(time[0], 10);
        s = parseInt(time[1], 10);
      } else if (time.length === 3) {
        h = parseInt(time[0], 10);
        m = parseInt(time[1], 10);
        s = parseInt(time[2], 10);
      }
    } else s = parseInt(string, 10);
    // eslint-disable-next-line no-mixed-operators
    return h * 60 * 60 + m * 60 + s;
  }
  /**
   * Parse number from input
   * @param {*} input Any
   * @returns {number}
   */
  static parseNumber(input) {
    if (typeof input === "string") return Number(input.replace(/\D+/g, ""));
    return Number(input) || 0;
  }
  /**
   * Clone an array or object
   * @param {Object} obj source
   * @returns {Object}
   */
  static clone(obj) {
    if (typeof obj === "function") return obj;
    const result = Array.isArray(obj) ? [] : {};
    for (const key in obj) {
      const value = obj[key];
      if (typeof value === "object") result[key] = this.clone(value);
      else result[key] = value;
    }
    return result;
  }
  /**
   * Check if the string is an URL
   * @param {string} string input
   * @returns {boolean}
   */
  static isURL(string) {
    if (string.includes(" ")) return false;
    try {
      const url = new URL(string);
      if (!["https:", "http:"].includes(url.protocol) ||
        url.origin === "null" || !url.host
      ) return false;
    } catch { return false }
    return true;
  }
}

module.exports = Util;
