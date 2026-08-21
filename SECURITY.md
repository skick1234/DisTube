# Security

Report vulnerabilities through the repository's private GitHub security advisory form. Do not include live provider
credentials, signed media URLs, or bot tokens in a public issue.

## Playable URLs

Source plugins must validate every redirect and destination before returning a playable URL. Official local engines
pass that validated URL to FFmpeg with redirects disabled. Public errors, diagnostics, and captured decoder output
redact complete URLs, query strings, credentials, and tokens.

FFmpeg still receives the playable URL as a process argument. Another process running as the same operating-system
user may inspect that argument while decoding is active. Run bots under a dedicated operating-system account and do
not share that account with untrusted workloads.

Lavalink URL playback is disabled unless the plugin enables `trustedUrlLoading`. Enable it only for nodes whose
operators enforce equivalent destination, redirect, response, deadline, and credential policy. Encoded-track playback
does not grant a node permission to load arbitrary URLs.
