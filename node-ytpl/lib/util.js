const ENTITIES = require('html-entities').AllHtmlEntities;
const URL = require('url');
const HTTPS = require('https');

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=';

// Parses the header information of a playlist
const AUTHOR_REFLINK_REGEXP = /<ul class="pl-header-details"><li>(.*?(?=<\/li>))<\/li><li>(.*?)(?=<\/li>)<\/li><li>(.*?(?=<\/li>))<\/li><li>(.*?(?=<\/li>))<\/li>/; // eslint-disable-line max-len
const PLAYLIST_NAME_REGEXP = /<h1 class="pl-header-title[^"]*" tabindex="0">\n[\s]*(.*?(?=\n))\n[\s]+(<\/h1>|<div)/;
exports.getGeneralInfo = (body, plistId) => {
  const importantTxt = exports.between(body, 'branded-page-box clearfix', '<div class="playlist-auxiliary-actions">');
  const authorMatch = importantTxt.match(AUTHOR_REFLINK_REGEXP);
  const description = exports.removeHtml(exports.between(
    importantTxt,
    '<span class="pl-header-description-text" tabindex="0">',
    '</span>',
  ).replace(/<button class="yt-uix-button[\s\S]+/, ''));

  return {
    id: plistId,
    url: PLAYLIST_URL + plistId,
    title: exports.removeHtml(importantTxt.match(PLAYLIST_NAME_REGEXP)[1]),
    visibility: importantTxt.includes('data-tooltip-text="') ? 'link only' : 'everyone',
    description: description ? exports.removeHtml(description) : null,
    total_items: Number(authorMatch[2].replace(/\D/g, '')),
    views: Number(authorMatch[3].replace(/\D/g, '')),
    last_updated: authorMatch[4],
    author: {
      id: exports.between(importantTxt, 'data-all-playlists-url="/channel/', '/playlists"'),
      name: exports.removeHtml(exports.between(authorMatch[1], '>', '</a>')),
      avatar: exports.between(body, '<img class="channel-header-profile-image" src="', '" title="'),
      user: importantTxt.includes('/user/') ? exports.between(authorMatch[1], 'href="/user/', '"') : null,
      channel_url: URL.resolve(
        PLAYLIST_URL,
        `/channel/${exports.between(importantTxt, 'data-all-playlists-url="/channel/', '/playlists"')}`,
      ),
      user_url: importantTxt.includes('/user/') ?
        URL.resolve(PLAYLIST_URL, exports.between(authorMatch[1], 'href="', '"')) :
        null,
    },
    nextpage: null,
    items: [],
  };
};

// Splits out the video container
exports.getVideoContainers = body => body
  .substring(body.indexOf('<tr class="'), body.lastIndexOf('</tr>'))
  .split('<tr')
  .splice(1);

// Builds an object representing a video of a playlist
exports.buildVideoObject = videoString => {
  const authorBox = exports.between(videoString, '<div class="pl-video-owner">', '</div>');
  const authorMatch = authorBox.match(/<a[^>]*>(.*)(?=<\/a>)/);
  return {
    id: exports.between(videoString, 'href="/watch?v=', '&amp;'),
    url: URL.resolve(PLAYLIST_URL, exports.removeHtml(exports.between(videoString, 'href="', '"'))),
    url_simple: URL.resolve(PLAYLIST_URL, exports.between(videoString, 'href="', '&amp;')),
    title: exports.removeHtml(exports.between(videoString, 'data-title="', '"')),
    thumbnail: URL.resolve(PLAYLIST_URL, exports.between(videoString, 'data-thumb="', '"').split('?')[0]),
    duration: videoString.includes('<div class="timestamp">') ?
      videoString.match(/<span aria-label="[^"]+">(.*?(?=<\/span>))<\/span>/)[1] :
      null,
    author: {
      name: authorMatch ? exports.removeHtml(authorMatch[0]) : null,
      ref: authorMatch ? URL.resolve(PLAYLIST_URL, exports.between(authorBox, 'href="', '"')) : null,
    },
  };
};

// Parse the input to a id (or error)
const PLAYLIST_REGEX = exports.PLAYLIST_REGEX = /^(PL|UU|LL|RD)[a-zA-Z0-9-_]{16,41}$/;
const ALBUM_REGEX = exports.ALBUM_REGEX = /^OLAK5uy_[a-zA-Z0-9-_]{33}$/;
const CHANNEL_REGEX = exports.CHANNEL_REGEX = /^UC[a-zA-Z0-9-_]{22,32}$/;
exports.getPlaylistId = (link, callback) => {
  // Return promise if no callback is defined
  if (!callback) {
    return new Promise((resolve, reject) => {
      exports.getPlaylistId(link, (err, info) => { // eslint-disable-line consistent-return
        if (err) return reject(err);
        resolve(info);
      });
    });
  }
  if (typeof link !== 'string') {
    return callback(new Error('The link has to be a string'));
  }
  if (PLAYLIST_REGEX.test(link)) {
    return callback(null, link);
  }
  const parsed = URL.parse(link, true);
  if (Object.hasOwnProperty.call(parsed.query, 'list')) {
    if (PLAYLIST_REGEX.test(parsed.query.list) || ALBUM_REGEX.test(parsed.query.list)) {
      return callback(null, parsed.query.list);
    }
    return callback(new Error('invalid list query in url'));
  }
  const p = parsed.pathname.split('/');
  const maybeType = p[p.length - 2];
  const maybeId = p[p.length - 1];
  if (maybeType === 'channel') {
    if (CHANNEL_REGEX.test(maybeId)) {
      return callback(null, `UU${maybeId.substr(2)}`);
    } else {
      return callback(new Error(`Unable to find a id in ${link}`));
    }
  } else if (maybeType === 'user') {
    return exports.userToChannelUploadList(maybeId, callback);
  } else {
    return callback(new Error(`Unable to find a id in ${link}`));
  }
};

// Gets the channel uploads id of a user (needed for uploads playlist)
const CHANNEL_REGEXP = /channel_id=UC([\w-]{22,32})"/;
exports.userToChannelUploadList = (user, callback) => {
  let finished = false;
  const req = HTTPS.get(`https://www.youtube.com/user/${user}`, resp => {
    const responseString = [];
    resp.on('data', data => {
      if (finished) return;
      responseString.push(data);
      const channelMatch = data.toString().match(CHANNEL_REGEXP);
      if (!channelMatch) return;
      finished = true;
      resp.req.abort();
      callback(null, `UU${channelMatch[1]}`);
    });
    resp.on('end', () => {
      if (finished) return;
      const channelMatch = Buffer.concat(responseString).toString().match(CHANNEL_REGEXP);
      if (channelMatch) return callback(null, `UU${channelMatch[1]}`); // eslint-disable-line consistent-return
      callback(new Error(`unable to resolve the user: ${user}`)); // eslint-disable-line consistent-return
    });
  });
  req.on('error', err => {
    if (finished) return;
    finished = true;
    callback(new Error(`request failed with err: ${err.message}`));
  });
};


// Taken from https://github.com/fent/node-ytdl-core/
exports.between = (haystack, left, right) => {
  let pos;
  pos = haystack.indexOf(left);
  if (pos === -1) { return ''; }
  haystack = haystack.slice(pos + left.length);
  if (!right) { return haystack; }
  pos = haystack.indexOf(right);
  if (pos === -1) { return ''; }
  haystack = haystack.slice(0, pos);
  return haystack;
};

// Cleans up html text
exports.removeHtml = string => new ENTITIES().decode(
  string.replace(/\n/g, ' ')
    .replace(/\s*<\s*br\s*\/?\s*>\s*/gi, '\n')
    .replace(/<\s*\/\s*p\s*>\s*<\s*p[^>]*>/gi, '\n')
    .replace(/<.*?>/gi, ''),
).trim();
