/**
 * DisTube audio filters.
 * @typedef {Object} DefaultFilters
 * @prop {string} 3d `@2.0.0`
 * @prop {string} bassboost `@2.0.0`
 * @prop {string} echo `@2.0.0`
 * @prop {string} karaoke `@2.0.0`
 * @prop {string} nightcore `@2.0.0`
 * @prop {string} vaporwave `@2.0.0`
 * @prop {string} flanger `@2.4.0`
 * @prop {string} gate `@2.4.0`
 * @prop {string} haas `@2.4.0`
 * @prop {string} reverse `@2.4.0`
 * @prop {string} surround `@2.7.0`
 * @prop {string} mcompand `@2.7.0`
 * @prop {string} phaser `@2.7.0`
 * @prop {string} tremolo `@2.7.0`
 * @prop {string} earwax `@2.7.0`
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
