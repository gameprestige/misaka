/**
 * 通过给对象的原型注入方法，使得任何对象都能轻松变成一个 event source。
 */
"use strict";

var _ = require("underscore");
var EventEmitter = require("events").EventEmitter;

var methods = ["emit", "on", "once", "addListener", "removeListener", "removeAllListeners"];

/**
 * 将 EventEmitter 所有方法注入到 constructor.prototype。
 * @param {Function} constructor
 */
module.exports = function(constructor) {
    if (!constructor || !constructor.prototype) {
        return constructor;
    }

    _.each(methods, function(method) {
        constructor.prototype[method] = function() {
            if (!this._events) {
                this._events = new EventEmitter();
            }

            return this._events[method].apply(this._events, arguments);
        };
    });

    return constructor;
};
