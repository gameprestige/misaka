/**
 * 一个来自 last order 的消息。
 */
"use strict";

function Message(cmd, cb) {
    this.cmd = cmd;
    this.name = "";
    this.match = null;
    this.queue = null;

    var me = this;
    this._isDone = false;
    this._cb = function() {
        if (me._isDone) {
            return;
        }

        me._isDone = true;
        cb.apply(me, arguments);
    };
}

module.exports = Message;

/**
 * 发送一个正常回复。
 * @param {String} text
 * @param {Object} [options]
 */
Message.prototype.send = function(text, options) {
    this._cb({
        text: text,
        options: options
    });
};

/**
 * 发送一个回复，出错时调用。
 * @param {String} text
 * @param {Object} [options]
 */
Message.prototype.error = function(text, options) {
    this._cb({
        error: true,
        text: text,
        options: options
    });
};

/**
 * 是否已经发送过应答。
 */
Message.prototype.isDone = function() {
    return this._isDone;
};
