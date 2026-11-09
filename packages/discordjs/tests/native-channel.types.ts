import type { VoiceBasedChannel } from "discord.js";
import type { DisTube } from "distube";

declare const music: DisTube<{ requestedBy: string }>;
declare const channel: VoiceBasedChannel;
void music.play(channel, "song", { metadata: { requestedBy: "user" } });
void music.voices.join(channel);
const voice = music.voices.get("guild");
if (voice) void voice.move(channel);
