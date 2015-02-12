/**
 * 按顺序执行一组命令，并自动在内存里记录所有的输出。
 */
"use strict";

var _ = require("underscore");

var quote = require("shell-quote").quote;
var debug = require("debug")("misaka");
var spawn = require("child_process").spawn;
var setImmediate = require("timers").setImmediate;

// 延时触发 watcher 可以让 watcher 一次看到更多有用信息，同时减少网络通信频率。
var WATCHER_DELAY = 500; // 单位 ms

// 全局的任务列表。
var runningJobs = {};

/**
 * 创建一个命令队列，如果任何一条命令失败，队列会自动结束。
 * @param cmd
 * @param {Function} done 命令完全完成之后的回调
 * @constructor
 */
function CommandQueue(cmd, done) {
    this.jobId = cmd.jobId;
    this.jobHash = cmd.jobHash;
    this.to = cmd.to;
    this.output = "";
    this.errors = "";

    this._queue = [];
    this._scheduled = false;
    this._runningCmd = null;

    this._updatingWatcher = false;
    this._watchers = [];

    this._done = done;
    this._action = null;
    this._isDone = false;
}

module.exports = CommandQueue;

/**
 * 通过 jobId 查找一个任务。
 * @param jobId
 */
CommandQueue.find = function(jobId) {
    if (!runningJobs.hasOwnProperty(jobId)) {
        return null;
    }

    return runningJobs[jobId];
};

/**
 * 执行一条命令，
 * @param {String|Array} cmd 可以是一个文本形式的命令行，也可以是预先分割好的数组
 * @param {Object|Function} [options] child_process.spawn 的 options
 * @param {Function} [cb] function(err, queue) 可选的回调，当这条命令结束时调用
 */
CommandQueue.prototype.exec = function(cmd, options, cb) {
    if (this._isDone) {
        return this;
    }

    if (typeof options === "function") {
        cb = options;
        options = null;
    }

    runningJobs[this.jobId] = this;

    if (Array.isArray(cmd)) {
        cmd = _.flatten(cmd);
    } else {
        cmd = ["/usr/bin/env", "sh", "-c", cmd + ""];
    }

    this._queue.push({
        cmd: cmd,
        options: options,
        cb: cb
    });
    this.scheduleExec();
    return this;
};

/**
 * 取消所有执行的命令，如果有命令正在执行，向命令发送 SIGTERM。
 */
CommandQueue.prototype.stop = function() {
    if (this._isDone || !this._runningCmd) {
        return this;
    }

    var running = this._runningCmd;
    debug("kill a command. [cmd:%s]", quote(running.cmd));
    running.proc.kill();
    return this;
};

/**
 * 跳过一些任务，只有还未执行的命令会受影响。
 * @param [count] 如果 count 不填或者为非正数，代表跳过所有未执行的命令
 */
CommandQueue.prototype.skip = function(count) {
    if (count > 0) {
        this._queue = this._queue.slice(count);
    } else {
        this._queue = [];
    }

    return this;
};

/**
 * 设置一个命令执行完成之后的回调，无论成功失败都会调用。
 * 如果在回调中继续调用 exec 执行命令，命令队列会重启并且继续执行到新的命令全部完成或出现异常。
 * @param {Function} action function(err, queue)
 */
CommandQueue.prototype.action = function(action) {
    this._action = action;
    return this;
};

/**
 * 添加一个 watcher，每次有 stdout/stderr 更新时都会调用 watcher。
 * @param {Function} watcher function(queue)
 */
CommandQueue.prototype.addWatcher = function(watcher) {
    if (!watcher) {
        return this;
    }

    this._watchers.push(watcher);
    return this;
};

/**
 * 移除一个 watcher。
 * @param {Function} watcher
 */
CommandQueue.prototype.removeWatcher = function(watcher) {
    if (!this._watchers.length) {
        return this;
    }

    this._watchers = this._watchers.filter(function(w) {
        return w !== watcher;
    });
    return this;
};

/**
 * 获得当前执行的命令字符串。
 */
CommandQueue.prototype.current = function() {
    if (!this._runningCmd) {
        return "";
    }

    return quote(this._runningCmd.cmd);
};

/**
 * 任务是否结束。
 */
CommandQueue.prototype.isDone = function() {
    return this._isDone;
};

/**
 * 准备开始执行命令。
 * @private
 */
CommandQueue.prototype.scheduleExec = function() {
    if (this._scheduled || this._isDone) {
        return;
    }

    var me = this;
    this._scheduled = true;
    setImmediate(function() {
        me.doExec();
    });
};

/**
 * 如果有任何 watcher 存在，通知它们数据已经有更新。
 * @private
 */
CommandQueue.prototype.notifyWatcher = function() {
    if (!this._watchers.length || this._updatingWatcher) {
        return;
    }

    this._updatingWatcher = true;

    var me = this;
    _.delay(function(watchers) {
        me._updatingWatcher = false;

        _.each(watchers, function(w) {
            try {
                w(me);
            } catch (e) {
                debug("fail to call watcher. [err:%s]", e);
            }
        });
    }, WATCHER_DELAY, this._watchers);
};

/**
 * 真正执行命令，直到所有命令都执行完。
 * @private
 */
CommandQueue.prototype.doExec = function() {
    if (this._isDone) {
        return;
    }

    // 队列空了
    if (!this._queue.length) {
        this._scheduled = false;

        if (this._action) {
            try {
                this._action(null, this);
            } catch (e) {
                debug("fail to execute action handler. [err:%s]", e);
            }
        }

        // 再次检查队列是否为空，如果 action 添加了新命令，那么要等命令全部执行完才算完成。
        if (this._queue.length) {
            return;
        }

        this._isDone = true;

        if (this._done) {
            try {
                this._done(null, this);
            } catch (e) {
                debug("fail to execute done handler. [err:%s]", e);
            }
        }

        delete runningJobs[this.jobId];
        return;
    }

    var info = this._queue[0];
    this._runningCmd = info;
    this._queue = this._queue.slice(1);

    var me = this;
    var exitCode = null;
    var cmd = info.cmd;
    var proc;

    if (info.options) {
        proc = spawn(cmd[0], cmd.slice(1), info.options);
    } else {
        proc = spawn(cmd[0], cmd.slice(1));
    }

    info.proc = proc;

    proc.stdout.on("data", function(data) {
        me.output += data;
        me.notifyWatcher();
    });
    proc.stderr.on("data", function(data) {
        me.output += data;
        me.errors += data;
        me.notifyWatcher();
    });
    proc.on("error", function(err) {
        debug("cannot execute command. [cmd:%s] [err:%s]", quote(cmd), err);

        if (exitCode !== null) {
            return;
        }

        exitCode = -1;
        err.code = -1;
        next(err);
    });
    proc.on("exit", function(code, signal) {
        debug("command is done. [code:%d] [signal:%s]", code, signal || "");

        if (exitCode !== null) {
            return;
        }

        var err = null;
        exitCode = code;

        if (exitCode) {
            err = new Error("fail to execute command");
            err.code = exitCode;
            err.signal = signal;
            next(err);
        } else {
            next();
        }
    });

    /**
     * 调用下一个命令。
     * @param [err]
     */
    function next(err) {
        if (info.cb) {
            try {
                info.cb(err, me);
            } catch (e) {
                debug("fail to call command handler. [err:%s]", e);
            }
        }

        if (err) {
            me.skip();
            me._isDone = true;

            if (me._action) {
                try {
                    me._action(err, me);
                } catch (e) {
                    debug("fail to execute action handler. [err:%s]", e);
                }
            }

            if (me._done) {
                try {
                    me._done(err, me);
                } catch (e) {
                    debug("fail to execute done handler. [err:%s]", e);
                }
            }

            delete runningJobs[me.jobId];
            return;
        }

        me.doExec();
    }
};
