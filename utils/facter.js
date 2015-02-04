/**
 * 封装 facter 命令，方便调用者获取各种服务器基本信息。
 */
"use strict";

var _ = require("underscore");

var debug = require("debug")("misaka");
var spawn = require("child_process").spawn;

/**
 * 通过 facter 查询一组 facts。
 *
 * 例如：
 *     var facter = require("path/to/facter");
 *     facter.query("fqdn", function(err, facts) {
 *         debug(facts.fqdn); // 输出查到的 fact
 *     });
 *     facter.query(["ipaddress", "fqdn"], function(err, facts) {
 *         debug(facts.ipaddress);
 *         debug(facts.fqdn);
 *     });
 *
 * @param {String|Array} facts 一个 fact 字符串，或者一个 fact 字符串数组。
 * @param cb
 */
exports.query = function(facts, cb) {
    if (!Array.isArray(facts)) {
        facts = [facts];
    }

    // 过滤非法输入
    var re = /^[0-9a-z][0-9a-z_-]*$/i;
    var argv = ["facter", "--json"];
    argv.push.apply(argv, facts.filter(function(fact) {
        return re.test(fact);
    }));

    var output = "";
    var facter = spawn("/usr/bin/env", argv);
    facter.stdout.on("data", function(data) {
        output += data;
    });
    facter.on("close", function(code) {
        if (code) {
            debug("fail to call facter. [code:%d] [cmd:%s]", code, argv.join(" "));
            cb(new Error("fail to call facter"));
            return;
        }

        try {
            var parsed = JSON.parse(output);
            var results = {};

            _.each(facts, function(fact) {
                results[fact] = parsed[fact] || null;
            });

            cb(null, results);
        } catch (e) {
            debug("fail to parse facter output. [output:%s] [cmd:%s]", output, argv.join(" "));
            cb(new Error("fail to parse facter output"));
        }
    });
};
