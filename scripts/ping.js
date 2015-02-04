/**
 * Ping: PONG!
 */
"use strict";

module.exports = function(misaka, config) {
    var PONG = config.response || "PONG";

    var ping = misaka.channel("ping", {
        usage: "ping",
        help: "确认御坂是否在周围，御坂顺从的说道",
        pattern: /ping$/i
    });
    ping.on("message", function(msg) {
        msg.send("PONG");
    });

    var pingText = misaka.channel("ping-text", {
        usage: "ping <text>",
        help: "就那么想让御坂照你说的回答么，御坂不耐烦的问道",
        pattern: /ping (.*)/i
    });
    pingText.on("message", function(msg) {
        var text = msg.match[1];
        msg.send("PONG " + text);
    });
};
