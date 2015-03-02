/**
 * Misaka 类，用于跟 last order 沟通并封装各种方法。
 */
"use strict";

var _ = require("underscore");
var debug = require("debug")("misaka");
var EventEmitter = require("events").EventEmitter;

var Message = require("./utils/message");
var CommandQueue = require("./utils/command_queue");
var Brain = require("./utils/brain");
var Script = require("./utils/script");
var Logger = require("./utils/logger");

var BRAIN_SAVE_TIMEOUT = 5000; // 单位毫秒

function Misaka(app) {
    this._app = app;
    this._scripts = {};

    var me = this;
    this._watcher = function(queue) {
        me.send({
            text: queue.output,
            to: queue.to,
            jobId: queue.jobId,
            jobHash: queue.jobHash
        });
        queue.output = "";
    };
    Object.defineProperty(this, "brain", {
        value: new Brain(function(patches, cb) {
            var done = false;

            // 如果规定时间内还没保存成功，也许是连不上 last order 了，放弃。
            var timer = setTimeout(function() {
                done = true;
                cb(new Error("timeout when saving patches"));
            }, BRAIN_SAVE_TIMEOUT);

            me._app.send("brain-patch", patches, function(values) {
                if (done) {
                    return;
                }

                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                done = true;
                cb(null, values);
            });
        })
    });
}

module.exports = Misaka;

/**
 * 向聊天室发消息。
 * @param {String|Object} msg 一段文本消息，或一个对象。对象格式如下：
 *                            {
 *                                text: "hello", // 消息文本
 *                                to: "huandu",  // 指定接收的用户名，"everyone" 代表所有人，默认不指定任何人
 *                                jobId: 12,     // 指定消息与这个任务关联
 *                                jobHash: "..." // 任务 hash，必须与 jobId 一起提供才有用
 *                            }
 */
Misaka.prototype.send = function(msg) {
    var text, to, jobId, jobHash;

    if (!msg) {
        return;
    }

    if (typeof msg === "object") {
        text = msg.text || "";
        to = msg.to || "";
        jobId = msg.jobId || 0;
        jobHash = msg.jobHash || "";
    } else {
        text = msg + "";
        to = "";
        jobId = 0;
        jobHash = "";
    }

    if (!text) {
        return;
    }

    // 走任务专用通道
    if (jobId && jobHash) {
        this._app.send("job", {
            to: to,
            text: text,
            jobId: jobId,
            jobHash: jobHash
        });
        return;
    }

    debug("sending text. [to:%s] [text:%s]", to, text);
    var fullMsg = "";

    if (to) {
        fullMsg += "@" + to + ": ";
    }

    fullMsg += text;
    this._app.send("message", fullMsg);
};

/**
 * 监听 socket 的各个有趣的频道。
 * 注意：永远不要保存 socket，因为 app 可能会因为断网而抛弃老的 socket。
 * @param socket
 */
Misaka.prototype.handleSocket = function(socket) {
    var me = this;
    socket.on("cmd", function(cmd, response) {
        dispatch(me, cmd, response);
    });
    socket.on("job", function(cmd) {
        jobControl(me, cmd);
    });
    socket.on("scripts", function(action, scriptStatus) {
        scriptsControl(me, action, scriptStatus);
    });
    socket.on("brain", function(data) {
        me.brain.load(data);
    });
    me.brain.save();
};

/**
 * 通过 channel 的 tag 来查找 channel 信息，只有启用了的 script 的 channel 会被返回。
 * @param [tag] 如果不提供 tag 则返回所有的 channel 信息
 * @return {Array} 返回所有匹配的 channel 信息，如果找不到匹配的 channel 返回 []
 */
Misaka.prototype.findChannels = function(tag) {
    var matches = [];

    _.each(this._scripts, function(script) {
        if (!script.enabled) {
            return;
        }

        var m = script.findChannels(tag);

        if (m.length) {
            matches = matches.concat(m);
        }
    });

    return matches;
};

/**
 * 检查一个脚本是否启用。
 * @param name
 */
Misaka.prototype.enabled = function(name) {
    return this._scripts.hasOwnProperty(name) && this._scripts[name].enabled;
};

/**
 * 派发命令，通过正则表达式选择一个匹配的命令。
 * 注意，script 需要自行保证自己正则表达式的全局唯一性，一般有一个合适的命令前缀就不会有问题。
 * @param {Misaka} misaka
 * @param cmd
 * @param cb
 */
function dispatch(misaka, cmd, cb) {
    var msg = new Message(cmd.cmd || "help", cb);
    var dispatcher = null;
    _.some(misaka._scripts, function(script) {
        if (!script.enabled) {
            return false;
        }

        dispatcher = script.matchChannel(msg.cmd);
        return !!dispatcher;
    });

    if (!dispatcher) {
        Logger.info("cannot find script to handle cmd. [cmd:%s]", msg.cmd);
        msg.error("御坂不支持这个命令：" + msg.cmd);
        return;
    }

    Logger.info("dispatching cmd... [cmd:%s]", msg.cmd);
    msg.queue = new CommandQueue(cmd, function(err) {
        var lines = ["```", msg.queue.output, "```"];
        var text;

        if (err) {
            lines.push("");
            lines.push("御坂执行命令失败，错误码 " + err.code + (err.signal? "，信号量 " + err.signal: ""));
        }

        if (!/^\s*$/.test(msg.queue.errors)) {
            lines.push("御坂提醒道，下面是所有的错误输出，请注意查看：");
            lines.push("```");
            lines.push(msg.queue.errors);
            lines.push("```");
        }

        text = lines.join("\n");

        if (err) {
            msg.error(text);
        } else {
            msg.send(text);
        }
    });
    dispatcher(msg);
}

/**
 * 响应 last order 的控制命令。
 * @param {Misaka} misaka
 * @param {Object} cmd
 */
function jobControl(misaka, cmd) {
    var action = cmd.action;
    var jobId = cmd.jobId;
    var jobHash = cmd.jobHash;
    var isStatus = action === "status";

    var queue = CommandQueue.find(jobId);

    if (!queue) {
        debug("job is not found. [action:%s] [job-id:%s] [job-hash:%s]", action, jobId, jobHash);

        if (isStatus) {
            misaka.send({
                text: "御坂充满怀疑的回复道，指定的任务 " + jobId + " 并不存在，或许早就结束了吧。",
                jobId: jobId,
                jobHash: jobHash
            });
        }

        return;
    }

    if (queue.jobHash !== jobHash) {
        debug("job was stopped or forgot by last order. stop again. [action:%s] [job-id:%s] [job-hash:%s]", action, jobId, jobHash);
        queue.stop();

        if (isStatus) {
            misaka.send({
                text: "御坂好奇的回答道，指定的任务 " + jobId + " 存在但是签名不匹配，或许御坂御坂强行遗忘了吧。",
                jobId: jobId,
                jobHash: jobHash
            });
        }

        return;
    }

    if (isStatus) {
        misaka.send({
            text: "御坂确定的回答道，指定的任务 " + jobId + " " + (queue.isDone()? "已经完成。": "仍在执行中，当前命令是：\n" + queue.current()),
            jobId: jobId,
            jobHash: jobHash
        });
        return;
    }

    switch (action) {
        case "watch":
            queue.addWatcher(misaka._watcher);
            break;

        case "unwatch":
            queue.removeWatcher(misaka._watcher);
            break;

        case "stop":
            queue.stop();
            break;

        default:
            debug("unknown action. [action:%s] [job-id:%s] [job-hash:%s]", action, jobId, jobHash);
    }
}

/**
 * 控制脚本的启用/禁用。
 * @param {Misaka} misaka
 * @param {String} action
 * @param {Object} scriptStatus
 */
function scriptsControl(misaka, action, scriptStatus) {
    var changes = {};
    var scripts = misaka._scripts;

    debug("script control. [action:%s] [status:%j]", action, scriptStatus);

    switch (action) {
        case "set":
            // 按照 last order 所说启用脚本，禁用所有未提到的脚本。
            _.each(scriptStatus, function(status, name) {
                changeScriptStatus(misaka, scripts, name, status);
                changes[name] = true;
            });

            _.each(misaka._scripts, function(script, name) {
                if (!changes.hasOwnProperty(name)) {
                    script.disable();
                }
            });
            break;

        case "update":
            // 启用/禁用指定的脚本。
            _.each(scriptStatus, function(status, name) {
                changeScriptStatus(misaka, scripts, name, status);
            });
            break;

        default:
            debug("unsupport script control action. [action:%s]", action);
    }
}

function changeScriptStatus(misaka, scripts, name, status) {
    var script;

    if (status) {
        if (scripts.hasOwnProperty(name)) {
            Logger.log("script %s is enabled.", name);
            scripts[name].enable();
        } else {
            script = new Script(name);
            script.init(misaka);

            if (script.loaded) {
                Logger.log("script %s is loaded and enabled.", name);
                scripts[name] = script.enable();
            } else {
                Logger.warn("script %s cannot be loaded.", name);
            }
        }
    } else {
        if (scripts.hasOwnProperty(name)) {
            Logger.log("script %s is disabled.", name);
            scripts[name].disable();
        }
    }
}
