/**
 * Misaka 类，用于跟 last order 沟通并封装各种方法。
 */
"use strict";

var _ = require("underscore");
var debug = require("debug")("misaka");
var EventEmitter = require("events").EventEmitter;

function Misaka(app) {
    this._app = app;
    this._channels = {};
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
 *                                to: "huandu"   // 指定接收的用户名，"everyone" 代表所有人，默认不指定任何人
 *                            }
 */
Misaka.prototype.send = function(msg) {
    var text, to;

    if (!msg) {
        return;
    }

    if (typeof msg === "object") {
        text = msg.text || "";
        to = msg.to || "";
    } else {
        text = msg + "";
        to = "";
    }

    if (!text) {
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

        app.send("register", {
            name: name,
            usage: cmd.usage,
            help: cmd.help
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
    var msg = new Message(cmd, cb);
    var found = _.some(this._channels, function(ch, name) {
        var match = ch.cmd.pattern.exec(cmd);

        if (!match) {
            return false;
        }

        debug("dispatching cmd... [name:%s] [cmd:%s]", name, cmd);
        msg.name = name;
        msg.match = match;
        ch.channel.emit("message", msg);
        return true;
    });

    if (found) {
        return;
    }

    debug("cannot find script to handle cmd. [cmd:%s]", cmd);
    msg.error("御坂不支持这个命令：" + cmd);
};

function Message(cmd, cb) {
    this.cmd = cmd;
    this.name = "";
    this.match = null;

    this._cb = cb;
}

/**
 * 发送一个正常回复。
 * @param {String} text
 */
Message.prototype.send = function(text) {
    this._cb({
        text: text
    });
};

/**
 * 发送一个回复，出错时调用。
 * @param {String} text
 */
Message.prototype.error = function(text) {
    this._cb({
        error: true,
        text: text
    });
};
