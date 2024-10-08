import type { PostListStyle } from "./components/PostListing";

/// Configure your page here
export default {
  /// Global configuration
  site: {
    /// Your public page URL
    url: "https://uwheel.github.io/",

    baseUrl: "",

    /// Your site's title
    title: "µWheel",

    /// Default site description
    description: "µWheel - Embeddable Aggregate Management For Streams and Queries",
  },

  layout: {
    pageSize: 5,

    /// Post list style
    postListStyle: "cards" as PostListStyle,

    landingPage: {
      /// Show recent posts on landing page
      showRecentPosts: true,
    },

    topbar: {
      links: [
        ["Posts", "/posts"],
        ["Tags", "/tags"],
      ],

      showThemeSwitch: true,

      showRssFeed: true,
    },

    footer: {
      showPoweredBy: true,
    },
  },

  /// Post page configuration
  post: {
    /// Show reading progress bar on top of page
    showReadingProgress: true,

    /// Shows a reading time estimate on top of every blog post
    readingTime: {
      enabled: true,

      /// Reading speed in words per minute (WPM) - 200 is a good baseline
      speed: 200,
    },

    /// Code editor configuration
    code: {
      /// See https://github.com/shikijs/shiki/blob/main/docs/themes.md
      ///
      /// NOTE: After changing, you need to restart the dev server because
      /// of a bug in Astro
      theme: {
        light: "one-light",
        dark: "rose-pine-moon",
      },
    },
  },
};
