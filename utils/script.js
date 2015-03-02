/**
 * 代表 scripts 目录下的一个 script 文件。
 */
"use strict";

var _ = require("underscore");
var path = require("path");
var EventEmitter = require("events").EventEmitter;
var debug = require("debug")("misaka");
var Logger = require("./logger");

var SCRIPTS_DIR = path.resolve(path.join(__dirname, "..", "scripts"));

function Script(name) {
    var script = null;

    try {
        script = require(path.join(SCRIPTS_DIR, name));

        if (!script || (typeof script !== "function" && typeof script.apply !== "function")) {
            Logger.error("script doesn't export correct init function. [name:%s]", name);
            script = null;
        }
    } catch (e) {
        Logger.error("cannot load script. [name:%s] [err:%s]", name, e);
    }

    this._name = name;

    this._loaded = !!script;
    this._script = script;
    this._enabled = false;
    this._channels = {};
}

module.exports = require("./event_source")(Script);

/**
 * 初始化一个脚本。
 * @param misaka
 */
Script.prototype.init = function(misaka) {
    if (!this._loaded) {
        return this;
    }

    try {
        this._script.apply(this, [misaka, this]);
    } catch (e) {
        debug("cannot init script. [name:%s] [err:%s]", this._name, e);
        this._loaded = false;
        this._script = null;
    }

    return this;
};

/**
 * 创建一个新的业务级 channel，并且规定如何通过命令来操作这个管道。
 *
 * 例子详见 scripts 里面的 ping.js
 *
 * @param {String} name channel 名字，应该是一个或多个可读的单词，以空格分隔
 * @param {Object} cmd 命令配置，格式为：
 *                 {
 *                     usage: "puppet <type>",        // 用法描述
 *                     help: "将执行 run-puppet 命令", // 一段文字描述
 *                     sample: "详细的执行方法...",     // （可选）详细的执行方法，如果是一个数组，则数组每个元素作为一行来显示
 *                     pattern: /run-puppet (\w+)/i,  // 用来匹配命令的正则表达式
 *                     tags: ["run-puppet"]           // （可选）命令的 tag，用于在 help/sample 中查找命令，默认的 tags 已经包含 name，所以只应该添加 name 没有的单词
 *                 }
 */
Script.prototype.channel = function(name, cmd) {
    var channels = this._channels;
    name = name.trim();

    if (channels.hasOwnProperty(name)) {
        debug("channel name has been used. [channel:%s]", name);
        throw new Error("channel name has been used");
    }

    if (!cmd || !cmd.usage || !cmd.help || !cmd.pattern) {
        debug("missing required field in cmd. [cmd:%s]", JSON.stringify(cmd));
        throw new Error("missing required field in cmd");
    }

    var tags = name.split(/\s+/).concat(cmd.tags || []);
    var tagMap = {};
    _.each(tags, function(tag) {
        tagMap[tag] = true;
    });

    var sample = cmd.sample;

    if (Array.isArray(sample)) {
        sample = sample.join("\n");
    }

    var channel = new EventEmitter();
    channels[name] = {
        channel: channel,
        usage: cmd.usage,
        help: cmd.help,
        sample: sample || "",
        pattern: cmd.pattern,
        tags: tagMap,
        enabled: false
    };
    return channel;
};

/**
 * 尝试寻找第一个能够处理 cmd 的 channel。
 * @param {String} cmd
 * @return {Function} 处理 msg 的函数
 */
Script.prototype.matchChannel = function(cmd) {
    var dispatcher = null;
    _.some(this._channels, function(ch, name) {
        var match = ch.pattern.exec(cmd);

        if (!match) {
            return false;
        }

        debug("found a matched channel. [name:%s]", name);
        dispatcher = function(msg) {
            msg.name = name;
            msg.match = match;
            ch.channel.emit("message", msg);
        };
        return true;
    });

    return dispatcher;
};

/**
 * 通过 channel 的 tag 来查找 channel 信息，只有启用了的 channel 才会被返回。
 * @param [tag] 如果不提供 tag 则返回所有的 channel 信息
 * @return {Array} 返回所有匹配的 channel 信息，如果找不到匹配的 channel 返回 []
 */
Script.prototype.findChannels = function(tag) {
    var matches = [];

    _.each(this._channels, function(ch, name) {
        if (tag && !ch.tags.hasOwnProperty(tag)) {
            return;
        }

        matches.push({
            name: name,
            usage: ch.usage,
            help: ch.help,
            sample: ch.sample,
            pattern: ch.pattern,
            tags: ch.tags
        });
    });

    return matches;
};

Object.defineProperties(Script.prototype, {
    /**
     * Script 的名字。
     */
    name: {
        get: function() {
            return this._name;
        }
    },

    /**
     * Script 是否被加载。
     */
    loaded: {
        get: function() {
            return this._loaded;
        }
    },

    /**
     * Script 是否被启用。
     */
    enabled: {
        get: function() {
            return this._enabled;
        }
    }
});

/**
 * 启用一个脚本。
 */
Script.prototype.enable = function() {
    if (this._enabled || !this._loaded) {
        return this;
    }

    this._enabled = true;
    this.emit("enabled", this);
    return this;
};

/**
 * 禁用一个脚本。
 */
Script.prototype.disable = function() {
    if (!this._enabled || !this._loaded) {
        return this;
    }

    this._enabled = false;
    this.emit("disabled", this);
    return this;
};
