const moment = require('moment');

const formatInt = (int) => {
  if (int < 10)
    return `0${int}`;
  return `${int}`;
};

module.exports.formatDuration = (milliseconds) => {
  if (!milliseconds || !parseInt(milliseconds)) return "00:00";
  const seconds = moment.duration(milliseconds).seconds();
  const minutes = moment.duration(milliseconds).minutes();
  const hours = moment.duration(milliseconds).hours();
  if (hours > 0) {
    return `${formatInt(hours)}:${formatInt(minutes)}:${formatInt(seconds)}`;
  }
  if (minutes > 0) {
    return `${formatInt(minutes)}:${formatInt(seconds)}`;
  }
  return `00:${formatInt(seconds)}`;
};

module.exports.toSecond = (string) => {
  if (!string) return 0;
  if (typeof string !== "string") return parseInt(string);
  let h = 0,
    m = 0,
    s = 0;
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
  return h * 60 * 60 + m * 60 + s;
};
