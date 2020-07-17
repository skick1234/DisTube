/// <reference types="node" />
declare module "duration" {
    function _exports(milliseconds: any): string;
    export = _exports;
}
declare module "Song" {
    export = Song;
    class Song {
        constructor(video: (import("ytdl-core").videoInfo | import("DisTube").ytpl_item), user: import("discord.js").User);
        user: import("discord.js").User;
        name: string;
        duration: number;
        formattedDuration: string;
        url: string;
        thumbnail: string;
        related: import("ytdl-core").relatedVideo[];
    }
}
declare module "Queue" {
    export = Queue;
    class Queue {
        constructor(guildID: string);
        id: string;
        dispatcher: import("discord.js").StreamDispatcher;
        connection: import("discord.js").VoiceConnection;
        volume: number;
        songs: import("Song")[];
        duration: number;
        formattedDuration: string;
        stopped: boolean;
        skipped: boolean;
        playing: boolean;
        pause: boolean;
        repeatMode: number;
        autoplay: boolean;
        filter: string;
        removeFirstSong(): void;
        updateDuration(): void;
    }
}
declare module "DisTube" {
    export = DisTube;
    const DisTube_base: typeof import("events").EventEmitter;
    class DisTube extends DisTube_base {
        constructor(client: import("discord.js").Client, otp?: DisTubeOptions);
        client: import("discord.js").Client;
        guilds: import("Queue")[];
        options: DisTubeOptions;
        play(message: import("discord.js").Message, song: (string | import("Song"))): Promise<void>;
        playSkip(message: import("discord.js").Message, song: (string | import("Song"))): Promise<void>;
        private _playlistHandler;
        search(string: string): import("Song")[];
        private _searchSong;
        private _newQueue;
        private _deleteQueue;
        getQueue(message: import("discord.js").Message): import("Queue");
        private _addToQueue;
        private _addVideosToQueue;
        pause(message: import("discord.js").Message): import("Queue");
        resume(message: import("discord.js").Message): import("Queue");
        stop(message: import("discord.js").Message): void;
        setVolume(message: import("discord.js").Message, percent: number): import("Queue");
        skip(message: import("discord.js").Message): import("Queue");
        shuffle(message: import("discord.js").Message): import("Queue");
        jump(message: import("discord.js").Message, num: number): import("Queue");
        setRepeatMode(message: import("discord.js").Message, mode?: number): number;
        toggleAutoplay(message: import("discord.js").Message): boolean;
        isPlaying(message: import("discord.js").Message): boolean;
        isPaused(message: import("discord.js").Message): boolean;
        private _isVoiceChannelEmpty;
        runAutoplay(message: import("discord.js").Message): import("Queue");
        setFilter(message: import("discord.js").Message, filter: string): string;
        private _playSong;
    }
    namespace DisTube {
        export { DisTubeOptions, ytpl_author, ytpl_item, ytpl_result };
    }
    namespace DisTubeOptions {
        export const emitNewSongOnly: boolean;
        export const leaveOnEmpty: boolean;
        export const leaveOnFinish: boolean;
        export const leaveOnStop: boolean;
        export const searchSongs: boolean;
    }
    type DisTubeOptions = {
        emitNewSongOnly?: boolean;
        leaveOnEmpty?: boolean;
        leaveOnFinish?: boolean;
        leaveOnStop?: boolean;
        searchSongs?: boolean;
    };
    type ytpl_author = {
        id: string;
        name: string;
        avatar: string;
        channel_url: string;
        user: string;
        user_url: string;
    };
    type ytpl_item = {
        id: string;
        url: string;
        url_simple: string;
        title: string;
        thumbnail: string;
        formattedDuration: string;
        duration: string;
        author: ytpl_author;
    };
    type ytpl_result = {
        user: import("discord.js").User;
        id: string;
        url: string;
        title: string;
        formattedDuration: string;
        duration: string;
        total_items: number;
        author: ytpl_author;
        items: ytpl_item[];
    };
}
