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

const merge = module.exports.mergeObject = (def, opt) => {
  if (!opt) return def;
  for (const key in def) {
    if (!Object.prototype.hasOwnProperty.call(opt, key) || opt[key] === undefined) {
      opt[key] = def[key];
    } else if (opt[key] === Object(opt[key])) {
      opt[key] = merge(def[key], opt[key]);
    }
  }
  return opt;
};

module.exports.isURL = string => {
  // eslint-disable-next-line no-new
  try { new URL(string) } catch { return false }
  return true;
};

/**
 * Whether or not the queue's voice channel is empty
 * @private
 * @ignore
 * @param {Queue} queue The guild queue
 * @returns {boolean} No user in voice channel return `true`
 */
module.exports.isVoiceChannelEmpty = queue => {
  let voiceChannel = queue.connection.channel;
  let members = voiceChannel.members.filter(m => !m.user.bot);
  return !members.size;
};
