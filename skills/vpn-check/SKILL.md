---
name: vpn-check
description: What to do when a request fails in a way a VPN could cause: a timeout, a refused or reset connection, a DNS or TLS error, a block page, captcha or 403. Load at the first such failure, before any retry.
---

# Failures a VPN could cause

- A request that fails in a way the user's VPN could cause, such as a timeout, a refused or reset
  connection, a DNS or TLS error, or a block page, captcha or 403 from a site that should answer,
  goes to Claude in Chrome first when curl, WebFetch or another fetch made it. When Chrome fails
  too, the session checks whether the VPN is on before it names the VPN: `scutil --nc list` marks
  each VPN service Connected or Disconnected, and `route -n get default` names a `utun` interface
  while a tunnel carries the default route. With the VPN off, the VPN is not named or asked about,
  and the session goes on to find the cause. With it on, the reply names the error and the hunch
  that the VPN may be the cause, hunch or not, and before any retry, workaround or other route, the
  reply asks whether to retry once the VPN is off or lets the request through, with going on through
  the VPN as the other option. The user switches the VPN; a session never turns it off or on, since
  it is a security setting. Once the retried request has its answer, the next reply opens by saying
  the VPN can go back on.
