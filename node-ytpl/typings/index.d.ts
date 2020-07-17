declare module 'ytpl' {
  namespace ytpl {
    type options = {
      /** Limits the pulled items. */
      limit?: number
    }
    type result = {
      id: string
      url: string
      title:string
      visibility: string
      description: string
      total_items: number
      views: string
      last_updated: string
      author: {
        id: string
        name: string
        avatar: string
        user: string
        channel_url: string
        user_url: string
      }
      items: {
        id: string
        url: string
        url_simple: string
        title: string
        thumbnail: string
        duration: string
        author: {
          id: string
          name: string
          user: string
          channel_url: string
          user_url: string
        }
      }[]
    }
    /**
     * @param link Link to validate
     * @description Returns true if able to parse out a (formally) valid playlist ID.
     */
    function validateURL(link: string): boolean;
    /**
     * @param link YouTube URL
     * @description Returns a promise that resovles to the playlist ID from a YouTube URL. Can be called with the playlist ID directly, in which case it returns it.
     */
    function getPlaylistID(link: string): Promise<string>;
    /**
     * @param link YouTube URL
     * @param callback Function, fired after the request is done. Contains an error or a result
     * @description Returns a playlist ID from a YouTube URL. Can be called with the playlist ID directly, in which case it returns it.
     * @returns A promise that resolves to a playlist ID or error.
     */
    function getPlaylistID(link: string, callback: ((err: Error, playlistID: string) => any)): void;
  }
  /**
   * @description Attempts to resolve the given playlist id
   * @param id Can be the id of the YT playlist or playlist link or user link (resolves uploaded playlist) or channel link (resolves uploaded playlist)
   * @param callback Function, fired after the request is done. Contains an error or a result
   */
  function ytpl(id: string, callback: ((err: Error, result: ytpl.result) => any)): void;
  /**
   * @description Attempts to resolve the given playlist id
   * @param id Can be the id of the YT playlist or playlist link or user link (resolves uploaded playlist) or channel link (resolves uploaded playlist)
   * @param options Object with options. limit[Number] -> limits the pulled items, defaults to 100, set to 0 or Infinity to get the whole playlist
   * @param callback Function, fired after the request is done. Contains an error or a result
   */
  function ytpl(id: string, options: ytpl.options, callback: ((err: Error, result: ytpl.result) => any)): void;
  /**
   * @description Attempts to resolve the given playlist id
   * @param id Can be the id of the YT playlist or playlist link or user link (resolves uploaded playlist) or channel link (resolves uploaded playlist)
   * @returns Promise that resolves to playlist data;
   */
  function ytpl(id: string): Promise<ytpl.result>;
  /**
   * @description Attempts to resolve the given playlist id
   * @param id Can be the id of the YT playlist or playlist link or user link (resolves uploaded playlist) or channel link (resolves uploaded playlist)
   * @param options Object with options. limit[Number] -> limits the pulled items, defaults to 100, set to 0 or Infinity to get the whole playlist
   * @returns Promise that resolves to playlist data;
   */
  function ytpl(id: string, options: ytpl.options): Promise<ytpl.result>;

  export = ytpl;
}
