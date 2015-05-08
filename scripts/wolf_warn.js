/**
 * 自动扫描所有的 warn 日志，一旦发现有新错误就发送广播给所有人。
 */
"use strict";

var _ = require("underscore");
var debug = require("debug")("misaka");

module.exports = function(misaka) {
    var scanner = misaka.scanner(function(files) {
        var lines = [];
        _.each(files, function(content, log) {
            if (!content) {
                return;
            }

            lines.push("* 日志文件：" + log + "\n```\n" + content + "\n```");
        });

        if (!lines.length) {
            return;
        }

        misaka.send("御坂发现新的错误日志！御坂大声警告所有人\n" + lines.join("\n\n"));
    });
    scanner.setBrain(misaka.brain, "warn_log");
    this.on("enabled", function() {
        scanner.start();
    });
    this.on("disabled", function() {
        scanner.stop();
    });

    var changeStatus = this.channel("warn log switch", {
        usage: "warn log [on|off]",
        help: "让御坂开始或停止监控错误日志，默认已启用监控",
        pattern: /^warn\s+log\s+(on|off|start|stop|pause)\s*$/i
    });
    changeStatus.on("message", function(msg) {
        var action = msg.match[1];

        if (action === "on" || action === "start") {
            scanner.start();
            msg.send("御坂已经开始日志监控");
        } else {
            scanner.stop();
            msg.send("御坂已经停止日志监控");
        }
    });

    var addLog = this.channel("warn log add", {
        usage: "warn log add <file...>",
        help: "添加新的文件到监控列表",
        pattern: /^warn\s+log\s+add\s*(.*)/i
    });
    addLog.on("message", function(msg) {
        var files = msg.match[1].split(/\s+/);
        var wrongFiles = [];
        var lines = [];

        _.each(files, function(file) {
            if (!file) {
                return;
            }

            if (file[0] !== '/') {
                wrongFiles.push(file);
                return;
            }

            scanner.addLog(file);
        });

        if (wrongFiles.length) {
            lines.push("御坂发现错误的输入，要监控的文件路径必须是一个绝对路径，御坂善意的提醒道。下面是错误的输入文件：");
            _.each(wrongFiles, function(file) {
                lines.push("* " + file);
            });
            lines.push("");
        }

        var logs = scanner.logs();
        lines.push("当前御坂正在监控的日志包括：");
        listLogs(logs, lines);

        msg.send(lines.join("\n"));
    });

    var removeLog = this.channel("warn log remove", {
        usage: "warn log add <file...>",
        help: "从监控列表移除文件",
        pattern: /^warn\s+log\s+remove\s*(.*)/i
    });
    removeLog.on("message", function(msg) {
        var files = msg.match[1].split(/\s+/);
        var lines = [];

        _.each(files, function(file) {
            scanner.removeLog(file);
        });

        var logs = scanner.logs();
        lines.push("当前御坂正在监控的日志包括：");
        listLogs(logs, lines);

        msg.send(lines.join("\n"));
    });

    var status = this.channel("warn log status", {
        usage: "warn log status",
        help: "查看当前日志监控状态以及监控文件详情",
        pattern: /^warn\s+log(\s+status)?\s*$/i
    });
    status.on("message", function(msg) {
        if (!scanner.started()) {
            msg.send("御坂现在并没有监控错误日志");
            return;
        }

        var lines = [];
        var logs = scanner.logs();
        lines.push("御坂现在正在监控的日志包括：");
        listLogs(logs, lines);

        msg.send(lines.join("\n"));
    });
};

function listLogs(logs, lines) {
    if (logs.length) {
        lines.push.apply(lines, logs.map(function(p) {
            return "* " + p;
        }));
    } else {
        lines.push("* 无");
    }
}
