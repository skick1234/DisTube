export = Util;
/** DisTube's Util */
declare class Util {
    /**
     * Format duration to string
     * @param {number} sec Duration in seconds
     * @returns {string}
     */
    static formatDuration(sec: number): string;
    /**
     * Convert formatted duration to seconds
     * @param {string} string Formatted duration string
     * @returns {number}
     */
    static toSecond(string: string): number;
    /**
     * Parse number from input
     * @param {*} input Any
     * @returns {number}
     */
    static parseNumber(input: any): number;
    /**
     * Check if the string is an URL
     * @param {string} string input
     * @returns {boolean}
     */
    static isURL(string: string): boolean;
}
