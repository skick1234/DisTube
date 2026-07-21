---
layout: home

hero:
  name: DisTube v6
  text: Discord audio orchestration
  tagline: Platform-neutral queues, direct adapters, and provider-owned source plugins.
  actions:
    - theme: brand
      text: API reference
      link: /api/
    - theme: alt
      text: Guides
      link: https://github.com/skick1234/DisTube/wiki

features:
  - title: Explicit ownership
    details: GuildQueue owns queue state and events while Adapter-created Players own playback effects.
  - title: Public contracts
    details: Adapters and SourcePlugins integrate through the public distube package without private support packages.
  - title: Independent releases
    details: Core, adapters, and media plugins retain package-owned tests, declarations, and packed-install verification.
---
