const HTTPS = require('https');
const UTIL = require('./util.js');

const getNonfirstPage = module.exports = (nextpageLink, options, callback) => {
  const request = HTTPS.get(`https://www.youtube.com${nextpageLink}&hl=en&disable_polymer=true`, { headers: options.headers }, resp => { // eslint-disable-line consistent-return, max-len
    if (resp.statusCode !== 200) {
      return callback(new Error(`Status code: ${resp.statusCode}`));
    }
    const response = [];
    resp.on('data', chunk => response.push(chunk));
    resp.on('end', () => { // eslint-disable-line consistent-return
      let parsedString;
      try {
        parsedString = JSON.parse(Buffer.concat(response).toString());
      } catch (err) {
        return callback(err);
      }

      // Split into important parts
      const content = parsedString.content_html;
      const nextpageRaw = parsedString.load_more_widget_html;
      const nextpage = UTIL.removeHtml(UTIL.between(nextpageRaw, 'data-uix-load-more-href="', '"')) || null;

      // Parse playlist items
      const items = UTIL.getVideoContainers(content)
        .map(item => UTIL.buildVideoObject(item))
        .filter((item, index) => !isNaN(options.limit) ? options.limit > index : true);

      // Update options.limit
      if (!isNaN(options.limit)) options.limit -= items.length;

      // Check wether there are more items and wether the limit wants us to download them
      if (!nextpage || (!isNaN(options.limit) && options.limit < 1)) {
        return callback(null, items);
      }

      getNonfirstPage(nextpage, options, (err, plist_items) => {
        if (err) return callback(err);
        return callback(null, items.concat(plist_items));
      });
    });
  });
  request.on('error', callback);
};
