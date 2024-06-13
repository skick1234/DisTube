# DisTube

## 1. Budget VPS Hosting

Blazingly fast, reliable VMs in 16 global locations at an extremely affordable price!

> Available locations: 🇺🇸 🇳🇱 🇸🇪 🇦🇹 🇳🇴 🇬🇧 🇨🇭 🇭🇰 🇸🇬 🇯🇵 🇦🇺\
> Premium DisTube Bots are hosted on this provider in Chicago 🇺🇸
> ​

### [Order Now!](https://skick.xyz/vps)

All plans, even **4$** plan, use the below specification:

- CPU: **AMD EPYC Milan**
- SSD: **Samsung Enterprise NVMe Storage**
- Public Network Port: **10Gbps | 40Gbps** (depends on location)

| CPU<br/>vCore | RAM<br/>GB | Storage<br/>GB | Price<br/>US$ |
| :-----------: | :--------: | :------------: | ------------: |
|       1       |     2      |       10       |            $4 |
|       2       |     4      |       20       |            $6 |
|       2       |     8      |       35       |            $9 |
|       4       |     12     |       50       |           $12 |
|       6       |     24     |      100       |           $22 |
|       8       |     32     |      125       |           $29 |
|       8       |     48     |      150       |           $39 |
|      12       |     64     |      200       |           $49 |
|      16       |     96     |      250       |           $69 |

## 2. FFMPEG_NOT_INSTALLED

### Reason

- FFmpeg is not installed

### Solution

- Install FFmpeg on: [Windows](http://blog.gregzaal.com/how-to-install-ffmpeg-on-windows/) - [Linux (Ubuntu, Mint,...)](https://www.tecmint.com/install-ffmpeg-in-linux/)
  > Download FFmpeg from [this repo](https://github.com/BtbN/FFmpeg-Builds/releases) if the download links are not available
- If you want to run FFmpeg from a custom path, or `ffmpeg-static`.path, e.t.c., you can use [`ffmpeg.path`](https://distube.js.org/types/DisTubeOptions.html) option.

## 3.1 The song ends instantly without any errors<br/>3.2 Error: write EPIPE

### Reason

- This is due to FFmpeg error.

### Solution:

- Check the FFmpeg log to check why it happens with [`ffmpegDebug`](https://distube.js.org/classes/DisTube.html#ffmpegDebug) event

```ts
import { Events } from "distube";
distube.on(Events.FFMPEG_DEBUG, console.log);
```

## 4.1 Error: Cannot find module '@discordjs/opus'<br/>4.2 RangeError: Source is too large<br/>4.3 RangeError: offset is out of bounds

### Reason

- `@discordjs/opus` package is not installed, or you installed `node-opus` or `opusscript` package (which is not stable)

### Solution

- Install `@discordjs/opus` package. Uninstall `node-opus`, `opusscript` if installed

```sh
npm uninstall opusscript node-opus
npm install @discordjs/opus
```

## 5. Error: VOICE_CONNECTION_TIMEOUT

### Reason

- It is due to your hosting/VPS network connection

### Solution

1. Try to join the voice channel with `<DisTube>.voices.join(voiceChannel)` before using `DisTube.play()`.\
   You can retry if this function throws the above error.

2. Use a better network service (like the above VPS)

## 6.1 My bot plays a random song after finishing all the queue<br/>6.2 How to turn off autoplay<br/>6.3 How to change queue's default properties

### Reason

- Autoplay is on by default.

### Solution

- To turn it on/off by a command, use [toggleAutoplay()](https://distube.js.org/#/docs/DisTube/main/class/DisTube?scrollTo=toggleAutoplay).
- To change the queue's default setting, use [initQueue](https://distube.js.org/#/docs/DisTube/main/class/DisTube?scrollTo=e-initQueue) event.

# YouTubePlugin

## 1. Error: Status code: 429

### Reason

- It is caused by requesting YouTube videos too fast.

### Solution

- Use `cookies` option (Guide: [[YouTube-Cookies]]).
  > You have to sign in before getting the cookie.
  > You may have to wait for YouTube to unblock your IP after getting this error.

## 2.1 Sign in to confirm you're not a bot<br/>2.2 Get the best YouTube experience

### Reason

- You are literally a Discord bot

### Solution

- Use `cookies` option (Guide: [[YouTube-Cookies]]).
  > You have to sign in before getting the cookie.

## 3. Sign in to confirm your age

### Reason

- Playing YouTube age-restricted videos

### Solution

- Use `cookies` option (Guide: [[YouTube-Cookies]]).
  > You have to sign in before getting the cookie.
  > Your account information must be at least 18 years old.

## 4. Error checking for updates: Status code 403

### Reason

- You are requested to github to many times (maybe due to restarting your bot). YouTubePlugin deps check their versions with github api so it can be rate-limited

### Solution

- Disable check for updates temporarily with their env variables

```ts
process.env.YTSR_NO_UPDATE = 1;
process.env.YTDL_NO_UPDATE = 1;
```
