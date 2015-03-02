/**
 * 仅仅是 console 的包装。
 */
"use strict";

var _ = require("underscore");
var moment = require("moment");
var format = require("util").format;

var methods = ["debug", "log", "info", "warn", "error"];

_.each(methods, function(method) {
    var verb = " [" + method.toUpperCase() + "] ";
    exports[method] = function() {
        var log = format.apply(null, arguments);
        console[method].call(console, moment().format() + verb + log);
    };
});
