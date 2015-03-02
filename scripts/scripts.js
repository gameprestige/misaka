/**
 * 列举当前所有脚本的状态。
 */
"use strict";

var _ = require("underscore");
var fs = require("fs");

var Logger = require("../utils/logger");

module.exports = function(misaka) {
    var scripts = this.channel("scripts", {
        usage: "scripts",
        help: "列举所有脚本的状态",
        pattern: /^scripts\s*$/i
    });
    scripts.on("message", function(msg) {
        fs.readdir(__dirname, function(err, files) {
            if (err) {
                Logger.error("cannot open dir. [dir:%s] [err:%s]", __dirname, err);
                msg.error("御坂无法读取脚本目录，错误是 " + err);
                return;
            }

            var lines = [];
            files = files.sort();
            _.each(files, function(f) {
                var name = f.replace(/\.(js|coffee)$/i, "");
                var status = misaka.enabled(name);

                lines.push((status? "✔ 已启用": "✘ 未启用") + "：`" + name + "`");
            });

            msg.send(lines.join("\n"));
        });
    });
};
