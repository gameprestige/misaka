/**
 * 报告当前服务器的时间。
 */
"use strict";

module.exports = function() {
    var time = this.channel("time", {
        usage: "time",
        help: "报告御坂当前时间",
        pattern: /^time\s*$/i
    });
    time.on("message", function(msg) {
        msg.send("当前时间是 " + new Date());
    });
};
