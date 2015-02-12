/**
 * 运行 run-puppet 命令。
 */
"use strict";

var _ = require("underscore");

module.exports = function(misaka) {
    var puppet = misaka.channel("puppet", {
        usage: "puppet <category...>",
        help: "执行 run-puppet 命令，执行 `$0 puppet help` 来查看这个命令支持的所有参数",
        pattern: /^puppet\s*(.*)$/i
    });
    puppet.on("message", function(msg) {
        var cmds = msg.match[1].split(/\s+/).filter(function(s) {
            return s;
        });

        if (!cmds.length || _.indexOf(cmds, "help") >= 0) {
            cmds = ["-h"];
        }

        var queue = msg.queue;

        // 如果装了 rvm，需要使用 rvmsudo
        queue.exec("which rvmsudo", function(err) {
            var sudo;

            // 没有安装 rvm，使用普通 sudo
            if (err) {
                sudo = "sudo";
            } else {
                sudo = "rvmsudo";
            }

            queue.output = queue.errors = "";
            queue.exec([sudo, "/usr/bin/env", "run-puppet", "--color=false", cmds]);
        });
    });
};
