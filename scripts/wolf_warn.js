/**
 * 自动扫描所有的 warn 日志，一旦发现有新错误就发送广播给所有人。
 */
"use strict";

var _ = require("underscore");
var fs = require("fs");

var debug = require("debug")("misaka");

var POLLING_INTERVAL = 10 * 1000; // 10s
var MAX_FILE_READ_SIZE = 256 * 1024; // 256KB

module.exports = function(misaka, config) {
    var scanner = new LogScanner(misaka, config.logs || []);
    scanner.start();

    var changeStatus = misaka.channel("warn log switch", {
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

    var status = misaka.channel("warn log status", {
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
        lines.push("御坂现在正在监控错误日志，监控的目录包括：");

        if (logs.length) {
            lines.push.apply(lines, logs.map(function(p) {
                return "* " + p;
            }));
        } else {
            lines.push("* 无");
        }

        msg.send(lines.join("\n"));
    });
};

function LogScanner(misaka, logs) {
    this._misaka = misaka;
    this._logs = logs;
    this._stats = {};
    this._timer = null;
}

/**
 * 启动日志扫描器。
 */
LogScanner.prototype.start = function() {
    if (this.started()) {
        return;
    }

    this.monitor();
};

/**
 * 停止日志扫描器。
 */
LogScanner.prototype.stop = function() {
    if (this._timer) {
        clearTimeout(this._timer);
    }

    this._timer = null;
};

LogScanner.prototype.monitor = function() {
    if (this._timer) {
        return;
    }

    var me = this;
    var misaka = this._misaka;
    this._timer = setTimeout(function() {
        var logs = me._logs;
        var stats = me._stats;
        var changedLogs = [];

        _.each(logs, function(log) {
            try {
                var stat = fs.statSync(log);
                var prev = stats[log] || {offset: 0};

                if (!stat.isFile()) {
                    return;
                }

                // 文件没有变化
                if (prev.size === stat.size && +prev.mtime === +stat.mtime) {
                    return;
                }

                // 文件被 truncate 过，重置 offset
                if (prev.offset && prev.offset > stat.size) {
                    prev.offset = 0;
                }

                stats[log] = {
                    size: stat.size,
                    mtime: stat.mtime,
                    offset: prev.offset
                };

                if (stat.size > prev.offset) {
                    changedLogs.push(log);
                }
            } catch (e) {
                debug("cannot stat log file. [log:%s] [err:%s]", log, e);
            }
        });

        if (!changedLogs.length) {
            me._timer = null;
            me.monitor();
            return;
        }

        debug("following logs are changed.");
        _.each(changedLogs, function(log) {
            debug("* %s", log);
        });

        scanLogs(changedLogs, stats, function(files) {
            var lines = [];
            _.each(files, function(content, log) {
                if (!content) {
                    return;
                }

                lines.push("* 日志文件：" + log + "\n```\n" + content + "\n```");
            });

            if (!lines.length) {
                me._timer = null;
                me.monitor();
                return;
            }

            misaka.send("御坂发现新的错误日志！御坂大声警告所有人\n" + lines.join("\n\n"));
            me._timer = null;
            me.monitor();
        });
    }, POLLING_INTERVAL);
};

/**
 * 判断是否已经启动。
 */
LogScanner.prototype.started = function() {
    return !!this._timer;
};

LogScanner.prototype.logs = function() {
    return this._logs;
};

/**
 * 循环读取所有 logs 文件变化的数据。
 * @param logs
 * @param stats
 * @param {Function} cb
 */
function scanLogs(logs, stats, cb) {
    var index = 0;
    var files = {};

    scan();

    function scan() {
        if (index >= logs.length) {
            cb(files);
            return;
        }

        var log = logs[index++];
        var stat = stats[log];

        if (!stat) {
            debug("cannot find file stat. why? [log:%s]", log);
            scan();
            return;
        }

        fs.open(log, "r", function(err, fd) {
            if (err) {
                debug("fail to open file. [log:%s] [err:%s]", log, err);
                scan();
                return;
            }

            readAll(fd, stat, function(err, output) {
                if (err) {
                    debug("fail to read log file. [log:%s] [err:%s]", log, err);
                    closeFdAndContinue(fd, log);
                    return;
                }

                files[log] = output;
                closeFdAndContinue(fd, log);
            });

        });
    }

    function closeFdAndContinue(fd, log) {
        fs.close(fd, function(err) {
            if (err) {
                debug("fail to close file fd. [fd:%s] [log:%s] [err:%s]", fd, log, err);
            }

            scan();
        });
    }

    function readAll(fd, stat, cb, output) {
        var size = stat.size - stat.offset;
        output = output || "";

        if (!size) {
            cb(null, output);
            return;
        }

        size = Math.min(size, MAX_FILE_READ_SIZE);
        var buffer = new Buffer(size);
        fs.read(fd, buffer, 0, size, stat.offset, function(err, read, buffer) {
            if (err) {
                cb(err);
                return;
            }

            if (!read) {
                cb(null, output);
                return;
            }

            stat.offset += read;
            output += buffer.toString();
            readAll(fd, stat, cb, output);
        });
    }
}
