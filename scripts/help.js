/**
 * 输出帮助信息。
 */
"use strict";

var _ = require("underscore");

module.exports = function(misaka) {
    var help = this.channel("help", {
        usage: "help",
        help: "显示御坂支持的命令",
        pattern: /^help\s*$/i
    });
    help.on("message", function(msg) {
        var channels = misaka.findChannels();
        msg.send(formatHelp(channels), {replace$0: true});
    });

    var helpCmd = this.channel("help cmd", {
        usage: "help <cmd>",
        help: "显示指定命令的帮助",
        pattern: /^help\s+(.+)$/i
    });
    helpCmd.on("message", function(msg) {
        var tag = msg.match[1].trim();
        var channels = misaka.findChannels(tag);
        msg.send(formatHelp(channels), {replace$0: true});
    });
};

function formatHelp(channels) {
    if (!channels.length) {
        return "御坂没找到相关的命令。";
    }

    var lines = [];
    var max = 0;

    _.each(channels, function(channel) {
        max = Math.max(max, channel.usage.length);
    });

    _.each(channels, function(channel) {
        var diff = max - channel.usage.length;
        lines.push("`$0 " + channel.usage + (new Array(diff + 1)).join(" ") + "` - " + channel.help);
    });

    return lines.join("\n");
}
