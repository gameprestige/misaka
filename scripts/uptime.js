/**
 * 显示 uptime。
 */
"use strict";

var debug = require("debug")("misaka");

module.exports = function(misaka) {
    var uptime = misaka.channel("uptime", {
        usage: "uptime",
        help: "显示御坂所在服务器的运行时间",
        pattern: /^uptime\s*$/i
    });
    uptime.on("message", function(msg) {
        msg.queue.exec("uptime");
    });
};
