/**
 * 查询当前机器的 facter。
 */
"use strict";

var _ = require("underscore");

var facter = require("../utils/facter");

module.exports = function() {
    var facts = this.channel("facter", {
        usage: "facter <facts...>",
        help: "查询任意的 facter，不知道什么是 facter，御坂建议去问问谷歌娘",
        sample: [
            "指定任意数目的 facts，御坂会通过 facter 命令来查询它们的值。",
            "例如可以这样用：",
            "`$0 facter ipaddress memoryfree`"
        ],
        pattern: /^facter\s+(.*)/i
    });
    facts.on("message", function(msg) {
        var keys = msg.match[1].split(/\s+/).filter(function(f) {
            return f;
        });

        if (!keys.length) {
            msg.send("请至少传一个 fact 名字过来，御坂略带不高兴的说道。");
            return;
        }

        facter.query(keys, function(err, facts) {
            if (err) {
                debug("cannot read from facter. [fact:%s] [err:%s]", keys.join(" "), err);
                msg.error("御坂无法从 facter 读取数据。错误：" + err);
                return;
            }

            var lines = [];

            lines.push("御坂找到了以下的 facts：");
            lines.push("```");

            _.each(facts, function(value, key) {
                lines.push(key + " => " + value);
            });

            lines.push("```");
            msg.send(lines.join("\n"));
        });
    });
};
