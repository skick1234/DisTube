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
    details: DisTubeGuild owns queue state, DisTubeVoice owns connections and settings, and DisTube starts playback directly.
  - title: Public contracts
    details: Applications import distube; adapters, sources and engines use type-only distube/integrations contracts.
  - title: Independent releases
    details: Core, adapters, and media plugins retain package-owned tests, declarations, and packed-install verification.
---
