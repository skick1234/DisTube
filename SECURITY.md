# Security

Report vulnerabilities through the repository's private GitHub security advisory form. Do not include live provider
credentials, signed media URLs, or bot tokens in a public issue.

## Playable URLs

The built-in engine in `@distube/discordjs` and `@distube/oceanic` fetches a `url` resource itself and decodes it
in-process with node-av. It follows up to five redirects to any HTTP or HTTPS host and does not check the host or
address of any hop. An HLS playlist loads its segments from whatever HTTP or HTTPS hosts it names. A plugin that
returns a URL a user typed therefore lets that user make the bot send requests to any address it can reach, including
loopback and private networks. Return URLs only from hosts you trust, or check the host in `resolve` and accept the
redirect risk. Public errors and diagnostics redact complete URLs, query strings, credentials, and tokens.

The Lavalink plugin plays only encoded tracks its nodes resolved. A node loads whatever identifier the plugin sends,
so the node's own source configuration decides which hosts it fetches.
