/**
 * Ping: PONG!
 */
"use strict";

var praises = [
    "かわいい",
    "可爱",
    "美丽",
    "cute",
    "lovely"
];

module.exports = function(misaka, config) {
    var PONG = config.response || "PONG";

    var ping = misaka.channel("ping", {
        usage: "ping",
        help: "确认御坂是否在线",
        pattern: /^ping\s*$/i
    });
    ping.on("message", function(msg) {
        msg.send("PONG");
    });

    var pingText = misaka.channel("ping text", {
        usage: "ping <text>",
        help: "确认御坂是否在线的同时让御坂复述一句话",
        sample: [
            "只要指定 <text>，御坂就会按照说的回答给你看！",
            "例如这样：",
            "`$0 ping 御坂，かわいい！`"
        ],
        pattern: /^ping\s+(.*)/i
    });
    pingText.on("message", function(msg) {
        var text = msg.match[1];
        var lines = ["PONG " + text];
        var hasPraise = praises.some(function(p) {
            return text.indexOf(p) >= 0;
        });

        if (hasPraise) {
            lines.push("呀，不要这么夸奖御坂，好害羞！御坂尝试学着姐姐大人以傲娇的语气回答道。");
        }

        msg.send(lines.join("\n"));
    });
};
