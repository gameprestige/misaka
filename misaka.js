/**
 * Misaka 类，用于跟 last order 沟通并封装各种方法。
 */
"use strict";

var _ = require("underscore");
var debug = require("debug")("misaka");
var EventEmitter = require("events").EventEmitter;

var Message = require("./utils/message");
var CommandQueue = require("./utils/command_queue");

function Misaka(app) {
    this._app = app;
    this._channels = {};

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
}

module.exports = Misaka;

/**
 * 创建一个新的业务级 channel，并且规定如何通过命令来操作这个管道。
 *
 * 例子详见 scripts 里面的 ping.js
 *
 * @param {String} name
 * @param {Object} cmd 命令配置，格式为：
 *                 {
 *                     usage: "run-puppet <type>",                // 用法描述
 *                     help: "将执行 run-puppet 命令，御坂谨慎的说", // 一段文字描述，格式必须是：xx，御坂yy的zz。xx 是描述，yy 是形容词，zz 是动词。
 *                     pattern: /run-puppet (\w+)/i               // 用来匹配命令的正则表达式
 *                 }
 */
Misaka.prototype.channel = function(name, cmd) {
    var channels = this._channels;

    if (channels.hasOwnProperty(name)) {
        debug("channel name has been used. [channel:%s]", name);
        throw new Error("channel name has been used");
    }

    if (!cmd || !cmd.usage || !cmd.help || !cmd.pattern) {
        debug("missing required field in cmd. [cmd:%s]", JSON.stringify(cmd));
        throw new Error("missing required field in cmd");
    }

    var channel = new EventEmitter();
    channels[name] = {
        channel: channel,
        cmd: cmd
    };
    return channel;
};

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
 * 向 last order 注册自己。
 * 每次连接上 last order 之后都会调用这个函数用来注册 channel。
 */
Misaka.prototype.register = function() {
    var app = this._app;
    _.each(this._channels, function(ch, name) {
        // 向 last order 注册自定义命令
        var cmd = ch.cmd;
        var sample = cmd.sample || "";

        if (Array.isArray(sample)) {
            sample = sample.join("\n");
        }

        app.send("register", {
            name: name,
            usage: cmd.usage,
            help: cmd.help,
            sample: sample
        });
    });
};

/**
 * 派发命令，通过正则表达式选择一个匹配的命令。
 * 注意，script 需要自行保证自己正则表达式的全局唯一性，一般有一个合适的命令前缀就不会有问题。
 * @param cmd
 * @param cb
 */
Misaka.prototype.dispatch = function(cmd, cb) {
    var msg = new Message(cmd.cmd, cb);
    msg.queue = new CommandQueue(cmd, function(err) {
        if (!err) {
            msg.send("```" + msg.queue.output + "```");
            return;
        }

        var lines = ["```", msg.queue.output, "```"];

        lines.push("");
        lines.push("御坂执行命令失败，错误码 " + err.code + (err.signal? "，信号量 " + err.signal: ""));
        lines.push("御坂提醒道，下面是所有的错误输出，请注意查看：");
        lines.push("```");
        lines.push(msg.queue.errors);
        lines.push("```");

        msg.error(lines.join("\n"));
    });

    var found = _.some(this._channels, function(ch, name) {
        var match = ch.cmd.pattern.exec(msg.cmd);

        if (!match) {
            return false;
        }

        debug("dispatching cmd... [name:%s] [cmd:%s]", name, msg.cmd);
        msg.name = name;
        msg.match = match;
        ch.channel.emit("message", msg);
        return true;
    });

    if (found) {
        return;
    }

    debug("cannot find script to handle cmd. [cmd:%s]", msg.cmd);
    msg.error("御坂不支持这个命令：" + msg.cmd);
};

/**
 * 响应 last order 的控制命令。
 * @param {Object} cmd
 */
Misaka.prototype.jobControl = function(cmd) {
    var action = cmd.action
    var jobId = cmd.jobId;
    var jobHash = cmd.jobHash;
    var isStatus = action === "status";

    var queue = CommandQueue.find(jobId);

    if (!queue) {
        debug("job is not found. [action:%s] [job-id:%s] [job-hash:%s]", action, jobId, jobHash);

        if (isStatus) {
            this.send({
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
            this.send({
                text: "御坂好奇的回答道，指定的任务 " + jobId + " 存在但是签名不匹配，或许御坂御坂强行遗忘了吧。",
                jobId: jobId,
                jobHash: jobHash
            });
        }

        return;
    }

    if (isStatus) {
        this.send({
            text: "御坂确定的回答道，指定的任务 " + jobId + " " + (queue.isDone()? "已经完成。": "仍在执行中，当前命令是：\n" + queue.current()),
            jobId: jobId,
            jobHash: jobHash
        });
        return;
    }

    switch (action) {
        case "watch":
            queue.addWatcher(this._watcher);
            break;

        case "unwatch":
            queue.removeWatcher(this._watcher);
            break;

        case "stop":
            queue.stop();
            break;

        default:
            debug("unknown action. [action:%s] [job-id:%s] [job-hash:%s]", action, jobId, jobHash);
    }
};
