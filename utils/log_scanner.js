/**
 * <DESCRIBE THIS FILE>
 * User: huandu
 * Create At: 2/6/15 5:15 PM
 */
"use strict";

var _ = require("underscore");
var fs = require("fs");

var debug = require("debug")("misaka");

var POLLING_INTERVAL = 10 * 1000; // 10s
var MAX_FILE_READ_SIZE = 256 * 1024; // 256KB

/**
 * LogScanner 可以用来监听任意数量的文件变化量，一旦有变化就通过 cb 通知调用者。
 * @param {Array} logs
 * @param {Function} cb function(files, scanner)
 * @constructor
 */
function LogScanner(logs, cb) {
    this._logs = logs;
    this._cb = cb;

    this._stats = {};
    this._timer = null;
}

module.exports = LogScanner;

/**
 * 启动日志扫描器。
 */
LogScanner.prototype.start = function() {
    if (this.started()) {
        return this;
    }

    this.monitor();
    return this;
};

/**
 * 停止日志扫描器。
 */
LogScanner.prototype.stop = function() {
    if (this._timer) {
        clearTimeout(this._timer);
    }

    this._timer = null;
    return this;
};

/**
 * 添加一个的监听文件。
 * @param log
 */
LogScanner.prototype.addLog = function(log) {
    // 忽略重复的文件
    if (_.indexOf(this._logs, log) >= 0) {
        return this;
    }

    this._logs.push(log);
    return this;
};

/**
 * 移除一个监听文静。
 * @param log
 */
LogScanner.prototype.removeLog = function(log) {
    this._logs = this._logs.filter(function(l) {
        return l !== log;
    });
    return this;
};

/**
 * 判断是否已经启动。
 */
LogScanner.prototype.started = function() {
    return !!this._timer;
};

/**
 * 获得所有监听的文件。
 * @returns {*}
 */
LogScanner.prototype.logs = function() {
    return this._logs;
};

/**
 * 不断循环监听所有文件的变化。
 * @private
 */
LogScanner.prototype.monitor = function() {
    if (this._timer) {
        return;
    }

    var me = this;
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
            if (me._cb) {
                try {
                    me._cb(files, me);
                } catch (e) {
                    debug("fail to call monitor callback. [err:%s]", e);
                }
            }

            me._timer = null;
            me.monitor();
        });
    }, POLLING_INTERVAL);
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