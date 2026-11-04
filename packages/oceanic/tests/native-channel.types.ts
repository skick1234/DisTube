import { DisTube } from "distube";
import type { Client, StageChannel, VoiceChannel } from "oceanic.js";
import { OceanicAdapter } from "../src";

declare const client: Client;
declare const channel: VoiceChannel;
declare const stage: StageChannel;
const music = new DisTube({ adapter: new OceanicAdapter(client), plugins: [] });
void music.play(channel, "song");
void music.play(stage, "song");
void music.voices.join(stage);
const voice = music.voices.get("guild");
if (voice) void voice.move(stage);
