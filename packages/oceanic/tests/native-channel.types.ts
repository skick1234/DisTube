import type { DisTube } from "distube";
import type { VoiceChannel } from "oceanic.js";

declare const music: DisTube<{ requestedBy: string }>;
declare const channel: VoiceChannel;
void music.play(channel, "song", { metadata: { requestedBy: "user" } });
void music.voices.join(channel);
const voice = music.voices.get("guild");
if (voice) void voice.move(channel);
