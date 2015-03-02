/**
 * Ping: PONG!
 */
"use strict";

module.exports = function() {
    var ping = this.channel("ping", {
        usage: "ping",
        help: "确认御坂是否在线",
        pattern: /^ping\s*$/i
    });
    ping.on("message", function(msg) {
        msg.send("PONG");
    });

    var pingText = this.channel("ping text", {
        usage: "ping <text>",
        help: "确认御坂是否在线的同时让御坂复述一句话",
        sample: [
            "只要指定 <text>，御坂就会按照说的回答给你看！",
            "例如这样：",
            "`$0 ping misaka`"
        ],
        pattern: /^ping\s+(.*)/i
    });
    pingText.on("message", function(msg) {
        msg.send("PONG " + msg.match[1]);
    });
};
