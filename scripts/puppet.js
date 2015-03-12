/**
 * 运行 run-puppet 命令。
 */
"use strict";

var _ = require("underscore");
var debug = require("debug")("misaka");

module.exports = function() {
    var puppet = this.channel("puppet", {
        usage: "puppet <category...>",
        help: "执行 run-puppet 命令，执行 `$0 puppet help` 来查看这个命令支持的所有参数",
        pattern: /^puppet\s*(.*)$/i
    });
    puppet.on("message", function(msg) {
        var cmds = msg.match[1].split(/\s+/).filter(function(s) {
            return s;
        });
        var queue = msg.queue;

        // 显示帮助
        if (!cmds.length || _.indexOf(cmds, "help") >= 0) {
            debug("run-puppet show help. [cmds:%j]", cmds);
            queue.exec(["/usr/bin/env", "run-puppet", "-h"]);
            return;
        }

        // 如果装了 rvm，需要使用 rvmsudo
        queue.exec("which rvmsudo", function(err) {
            queue.clearError();

            var sudo;

            // 没有安装 rvm，使用普通 sudo
            if (err) {
                sudo = "sudo";
            } else {
                sudo = "rvmsudo";
            }

            queue.output = queue.errors = "";
            debug("run-puppet: ready to execute command. [sudo:%s] [cmds:%j]", sudo, cmds);
            queue.exec([sudo, "/usr/bin/env", "run-puppet", cmds, "--", "--color=false"]);
        });
    });
};
