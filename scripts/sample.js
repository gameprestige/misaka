/**
 * 输出命令的详细说明。
 */
"use strict";

var _ = require("underscore");

module.exports = function(misaka) {
    var sample = this.channel("sample", {
        usage: "sample <cmd>",
        help: "显示指定命令的详细帮助",
        pattern: /^sample\s+(.+)$/i
    });
    sample.on("message", function(msg) {
        var tag = msg.match[1].trim();
        var channels = misaka.findChannels(tag);

        if (!channels.length) {
            msg.send("御坂没找到相关的命令。");
            return;
        }

        var lines = [];

        _.each(channels, function(ch) {
            lines.push("命令：`" + ch.usage + "`");

            if (ch.sample) {
                lines.push(ch.sample);
            } else {
                lines.push("没有更详细的说明……");
            }

            lines.push("");
        });

        msg.send(lines.slice(0, lines.length - 1).join("\n"), {replace$0: true});
    });
};
