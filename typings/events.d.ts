export = DisTube;
declare class DisTube extends EventEmitter {
	on(
		event: "addList",
		listener: (queue: Queue, playlist: Playlist) => void
	): this;
	on(
		event: "addSong" | "playSong" | "finishSong",
		listener: (queue: Queue, song: Song) => void
	): this;
	on(
		event: "empty" | "finish" | "initQueue" | "noRelated" | "disconnect",
		listener: (queue: Queue) => void
	): this;
	on(
		event: "error",
		listener: (channel: Discord.TextChannel, error: Error) => void
	): this;
	on(
		event: "searchNoResult" | "searchCancel",
		listener: (message: Discord.Message, query: string) => void
	): this;
	on(
		event: "searchResult",
		listener: (
			message: Discord.Message,
			results: SearchResult[],
			query: string
		) => void
	): this;
	on(
		event: "searchDone",
		listener: (
			message: Discord.Message,
			answer: Discord.Message,
			query: string
		) => void
	): this;
}
import { EventEmitter } from "events";
import Discord = require("discord.js");
import Queue = require("./Queue");
import Song = require("./Song");
import SearchResult = require("./SearchResult");
import Playlist = require("./Playlist");
