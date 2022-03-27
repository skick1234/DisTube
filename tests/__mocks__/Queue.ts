const methods = ["addToQueue", "skip", "stop", "remove"] as const;

export class Queue {
  voice: any;
  id: any;
  songs: any;
  previousSongs: any;
  textChannel: any;
  _taskQueue: any;
  distube: any;
  [x: string]: jest.Mock;
  constructor(distube: any, voice: any, song: any, textChannel: any) {
    this.distube = distube;
    this.id = voice.id;
    this.voice = voice;
    this.songs = Array.isArray(song) ? [...song] : [song];
    this.previousSongs = [];
    this.textChannel = textChannel;
    this._taskQueue = {
      queuing: jest.fn(),
      resolve: jest.fn(),
    };
    for (const method of methods) {
      this[method] = jest.fn();
    }
  }
}

export default { Queue };
