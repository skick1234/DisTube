const moment = require('moment');

const formatInt = (int) => {
  if (int < 10) {
    return `0${int}`;
  }
  return `${int}`;
};

module.exports = (milliseconds) => {
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