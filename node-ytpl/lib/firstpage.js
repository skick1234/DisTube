const HTTPS = require('https');
const UTIL = require('./util.js');

const NEXTPAGE_REGEXP_L = /"(\/browse_ajax\?action_continuation=1&amp;continuation=([^"]+))"/;
const ERROR_REGEXP_G = /<div class="yt-alert-message" tabindex="0">\n[\s]+([^\n]+)[\s]+<\/div>/g;
const ERROR_REGEXP_L = /<div class="yt-alert-message" tabindex="0">\n[\s]+([^\n]+)[\s]+<\/div>/;

const IGNORABLE_ERRORS = [string => string.includes('<a href="/new">')];

module.exports = (playlistID, options, callback) => {
  const request = HTTPS.get(`https://www.youtube.com/playlist?list=${playlistID}&hl=en&disable_polymer=true`, { headers: options.headers }, resp => { // eslint-disable-line consistent-return, max-len
    if (resp.statusCode !== 200) {
      if (resp.statusCode === 303) return callback(new Error('Playlist not avaible'));
      return callback(new Error(`Status code: ${resp.statusCode}`));
    }
    const respBuffer = [];
    resp.on('data', data => respBuffer.push(data));
    resp.on('end', () => { // eslint-disable-line consistent-return
      const respString = Buffer.concat(respBuffer).toString();
      // Check wether theres an error in error box
      const errorMatch = respString.match(ERROR_REGEXP_G);
      if (errorMatch) {
        const validErrors = errorMatch
          .map(item => item.match(ERROR_REGEXP_L)[1])
          .filter(item => !IGNORABLE_ERRORS.some(func => func(item)));
        if (validErrors.length) return callback(new Error(validErrors));
      }

      // Get general playlist informations
      const response = UTIL.getGeneralInfo(respString, playlistID);

      // Parse videos
      response.items = UTIL.getVideoContainers(respString)
        .map(item => UTIL.buildVideoObject(item))
        .filter((item, index) => !isNaN(options.limit) ? options.limit > index : true);

      // Check wether there are more pages
      const nextpageLink = respString.match(NEXTPAGE_REGEXP_L);
      if (nextpageLink) response.nextpage = UTIL.removeHtml(nextpageLink[1]);

      // Update limit
      if (!isNaN(options.limit)) options.limit -= response.items.length;
      callback(null, response);
    });
  });
  request.on('error', callback);
};
