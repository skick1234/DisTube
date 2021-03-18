/**
 * Default DisTube audio filters.
 * @typedef {Object} DefaultFilters
 * @prop {string} 3d 3d
 * @prop {string} bassboost bassboost
 * @prop {string} echo echo
 * @prop {string} karaoke karaoke
 * @prop {string} nightcore nightcore
 * @prop {string} vaporwave vaporwave
 * @prop {string} flanger flanger
 * @prop {string} gate gate
 * @prop {string} haas haas
 * @prop {string} reverse reverse
 * @prop {string} surround surround
 * @prop {string} mcompand mcompand
 * @prop {string} phaser phaser
 * @prop {string} tremolo tremolo
 * @prop {string} earwax earwax
 */
module.exports = {
  "3d": "apulsator=hz=0.125",
  bassboost: "bass=g=10,dynaudnorm=f=150:g=15",
  echo: "aecho=0.8:0.9:1000:0.3",
  flanger: "flanger",
  gate: "agate",
  haas: "haas",
  karaoke: "stereotools=mlev=0.1",
  nightcore: "asetrate=48000*1.25,aresample=48000,bass=g=5",
  reverse: "areverse",
  vaporwave: "asetrate=48000*0.8,aresample=48000,atempo=1.1",
  mcompand: "mcompand",
  phaser: "aphaser",
  tremolo: "tremolo",
  surround: "surround",
  earwax: "earwax",
};
