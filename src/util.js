const formatInt = int => int < 10 ? `0${int}` : int;

/**
 * Convert milliseconds to `hh:mm:ss` string
 * @param {number} milliseconds milliseconds
 * @returns {string}
 * @ignore
 */
module.exports.formatDuration = milliseconds => {
  if (!milliseconds || !parseInt(milliseconds)) return "00:00";
  const seconds = Math.floor(milliseconds % 60000 / 1000);
  const minutes = Math.floor(milliseconds % 3600000 / 60000);
  const hours = Math.floor(milliseconds / 3600000);
  if (hours > 0) {
    return `${formatInt(hours)}:${formatInt(minutes)}:${formatInt(seconds)}`;
  }
  if (minutes > 0) {
    return `${formatInt(minutes)}:${formatInt(seconds)}`;
  }
  return `00:${formatInt(seconds)}`;
};

/**
 * Convert `hh:mm:ss` string to seconds
 * @param {string} string duration
 * @returns {number}
 * @ignore
 */
module.exports.toSecond = string => {
  if (!string) return 0;
  if (typeof string !== "string") return parseInt(string) || 0;
  let h = 0, m = 0, s = 0;
  if (string.match(/:/g)) {
    let time = string.split(":");
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
};

/**
 * Convert string of int to number
 * @param {string} string string
 * @returns {number}
 * @ignore
 */
module.exports.parseNumber = string => (typeof string === "string" ? Number(string.replace(/\D+/g, "")) : Number(string)) || 0;
