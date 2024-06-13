# Why using cookies

- Prevent YouTube rate limiting (429 Error)
- Capable of playing videos accessible through your account, including age-restricted, exclusive member, premium, private, and more.

# How to get cookies

- Install [EditThisCookie](http://www.editthiscookie.com/) extension for your browser.
- Go to [YouTube](https://www.youtube.com/).
- Log in to your account. (You should use a new account for this purpose)
- Click on the extension icon and click "Export".
- Copy the content of the exported file and paste it into your code.

```ts
import { DisTube } from "distube";
import { YouTubePlugin } from "@distube/youtube";

const distube = new DisTube({
  plugins: [
    new YouTubePlugin({
      cookies: [
        {
          domain: ".youtube.com",
          expirationDate: 1234567890,
          hostOnly: false,
          httpOnly: true,
          name: "XXX",
          path: "/",
          sameSite: "no_restriction",
          secure: true,
          session: false,
          value: "---xxx---",
        },
        {
          domain: ".youtube.com",
          "...": "...",
        },
      ],
    }),
  ],
});
```

- Or you can paste it into a file and use `fs.readFileSync` to read it.

```js
const { DisTube } = require("distube");
const fs = require("fs");

const distube = new DisTube({
  plugins: [new YouTubePlugin({ cookies: JSON.parse(fs.readFileSync("cookies.json")) })],
});
```
