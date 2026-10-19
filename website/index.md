---
layout: home

hero:
  name: DisTube v6
  text: Discord audio orchestration
  tagline: Play a query, then control its queue and attached voice.
  actions:
    - theme: brand
      text: API reference
      link: /api/
    - theme: alt
      text: Guides
      link: https://github.com/skick1234/DisTube/wiki

features:
  - title: Music commands first
    details: distube.play(channel, input) returns the queue after insertion. The queue controls playback and exposes its attached voice.
  - title: Public contracts
    details: Applications import distube; adapters, sources and engines use type-only distube/integrations contracts.
  - title: Independent releases
    details: Core, adapters, and media plugins retain package-owned tests, declarations, and packed-install verification.
---
