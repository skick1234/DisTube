import { defineConfig } from "vitepress";

export default defineConfig({
  title: "DisTube v6",
  description: "Queue and playback orchestration for Discord audio",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "API", link: "/api/" },
    ],
    sidebar: [
      { text: "Overview", link: "/" },
      { text: "API reference", link: "/api/" },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/skick1234/DisTube" }],
  },
});
