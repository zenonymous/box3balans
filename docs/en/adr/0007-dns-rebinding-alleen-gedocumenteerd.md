# DNS rebinding: documented, no list of allowed host names

_Nederlands: [0007-dns-rebinding-alleen-gedocumenteerd.md](../../adr/0007-dns-rebinding-alleen-gedocumenteerd.md)_

As long as there's no user yet, a website on the same network could create the first user through DNS rebinding. After that, signing in is required, and the session cookie belongs to the real host name, so such a site doesn't get it. A list of allowed host names would close that gap, but requires everyone to configure every name and IP address they reach the app with (IP, `nas.local`, a VPN name, a reverse proxy), or the app won't work. So the risk is described in the README, with the advice to create the user right after installing.
