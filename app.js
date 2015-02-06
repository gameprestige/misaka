/**
 * 客户端的全局对象。
 */
"use strict";

var _ = require("underscore");
var crypto = require("crypto");
var url = require("url");
var fs = require("fs");
var path = require("path");

var io = require("socket.io-client");
var request = require("request");

var debug = require("debug")("misaka");
var setImmediate = require("timers").setImmediate;

var Misaka = require("./misaka");
var Logger = require("./utils/logger");

var LOGIN_RETRY_INTERVAL = 5 * 1000; // 5s 重试一次

function App() {
    this._node = "";

    this._lastOrderUrl = url.parse(ensureEnv("LAST_ORDER_URL"));
    this._sistersSecret = ensureEnv("SISTERS_SHARED_SECRET");
    this._misaka = new Misaka(this);
    this._socket = null;
    this._connected = false;

    this._sendingQueue = [];
    this._sending = false;
}

module.exports = new App();

/**
 * 启动 Misaka 服务。
 */
App.prototype.start = function(node) {
    debug("starting with name '%s'...", node);
    this._node = node;

    var misaka = this._misaka;
    loadScripts(function(script, config) {
        script(misaka, config);
    });

    this.connect();
};

/**
 * 向 last order 的指定 channel 发送一段消息。
 * @param {String} channel
 * @param data
 */
App.prototype.send = function(channel, data) {
    this._sendingQueue.push([channel, data]);
    this.scheduleFlush();
};

/**
 * 确保已经连接到 last order。如果没有连接则尝试连接。
 */
App.prototype.connect = function() {
    if (this._connected) {
        return;
    }

    debug("try to connect...");
    this._sendingQueue.push(null);
    this.scheduleFlush();
};

/**
 * 尝试登录到 last order 服务器，如果登录失败会无限次重试直到成功。
 * 注意，这个函数不能并发调用。
 *
 * @private
 * @param {Function} cb function(socket) 登录的回调。
 */
App.prototype.login = function(cb) {
    if (this._connected) {
        cb(this._socket);
        return;
    }

    var me = this;
    this.tryLogin(login);

    function login(err, socket) {
        if (err) {
            debug("login failed... [err:%s]", err);
            setTimeout(function() {
                me.tryLogin(login);
            }, LOGIN_RETRY_INTERVAL);
            return;
        }

        debug("socket is connecting...");

        me._socket = socket;
        socket.on("connect", function() {
            debug("misaka connects to last order.");
            me._misaka.register();
            me._connected = true;
            cb(socket);
        });
        socket.on("disconnect", function() {
            debug("misaka losts connection with last order.");
            me._socket = null;
            me._connected = false;

            // 尝试重新连接
            me.connect();
        });
        socket.on("cmd", function(cmd, response) {
            me._misaka.dispatch(cmd, response);
        });
        socket.on("job", function(cmd) {
            me._misaka.jobControl(cmd);
        });
    }
};

/**
 * 尝试登录到 last order 服务器。
 *
 * 登录流程是：
 * 1. POST /challenge 获得 challenge
 * 2. POST /login 获得登录 token
 * 3. 连接 socket.io 服务
 *
 * @private
 * @param cb {Function} cb function(err, socket) 登录的回调。
 */
App.prototype.tryLogin = function(cb) {
    if (this._socket) {
        cb(null, this._socket);
        return;
    }

    var me = this;
    var node = this._node;
    var ts = Date.now();
    var secret = this._sistersSecret;

    request.post(me.makeUrl("/challenge"), {
        form: {
            node: node,
            ts: ts,
            sig: strDigest(ts + "&" + node, secret)
        }
    }, function(err, resp, body) {
        if (err) {
            debug("fail to POST /challenge. [err:%s]", err);
            cb(err);
            return;
        }

        if (resp.statusCode !== 200) {
            debug("fail to POST /challenge with response. [status:%s] [err:%s] [body:%s]", resp.statusCode, err, body);
            cb(new Error("fail to POST /challenge"));
            return;
        }

        var challenge = body + "";
        request.post(me.makeUrl("/login"), {
            form: {
                challenge: challenge,
                node: node,
                sig: strDigest(challenge + "&" + node, secret)
            }
        }, function(err, resp, body) {
            if (err) {
                debug("fail to POST /login. [err:%s]", err);
                cb(err);
                return;
            }

            if (resp.statusCode !== 200) {
                debug("fail to POST /login with response. [status:%s] [err:%s] [body:%s]", resp.statusCode, err, body);
                cb(new Error("fail to POST /login"));
                return;
            }

            var socket = io(me.makeUrl("/misaka", {token: body}), {
                reconnection: false,
                multiplex: false,
                transports: ["websocket", "polling"]
            });
            cb(null, socket);
        });
    });
};

/**
 * 在下一次 io 回调中 flush 所有未发送的数据。
 */
App.prototype.scheduleFlush = function() {
    if (this._sending) {
        return;
    }

    var me = this;
    this._sending = true;
    setImmediate(function() {
        me.flush();
    });
};

/**
 * 发送所有未发送的消息。
 * @private
 */
App.prototype.flush = function() {
    var me = this;
    var queue = this._sendingQueue;
    this._sendingQueue = [];

    if (!queue.length) {
        me._sending = false;
        return;
    }

    this.login(function(socket) {
        _.each(queue, function(data) {
            if (!data) {
                return;
            }

            socket.emit(data[0], data[1]);
        });

        // 确保没有更多数据要发送
        me.flush();
    });
};

/**
 * 获得完整的请求 url。
 *
 * @private
 * @param path
 * @param [query]
 */
App.prototype.makeUrl = function(path, query) {
    var base = this._lastOrderUrl;
    return url.format({
        protocol: base.protocol,
        host: base.host,
        pathname: path,
        query: query
    });
};

function ensureEnv(env) {
    if (!process.env.hasOwnProperty(env)) {
        console.warn("missing required environment variable %s.", env);
        process.exit(1);
        return undefined;
    }

    return process.env[env];
}

function strDigest(str, secret) {
    var hmacSHA1 = crypto.createHmac("sha1", secret);
    hmacSHA1.update(str);
    return hmacSHA1.digest("base64");
}

/**
 * 加载所有启用的脚本。
 * 只有 config 目录下有配置的脚本才算启用。
 * 比如要启用 scripts/ping.js，必须有一个 config/ping.js 存在才可以启用。
 * @param {Function} cb function(script, config)
 */
function loadScripts(cb) {
    var configFiles = fs.readdirSync(path.join(__dirname, "config"));

    // 只保留 *.js 文件
    var re = /\.js$/i;
    configFiles = _.filter(configFiles, function(file) {
        return re.test(file);
    });

    // 尝试加载 scripts 目录对应文件
    _.each(configFiles, function(file) {
        var name = path.basename(file, ".js");
        var config = "./config/" + name;
        var script = "./scripts/" + name;

        try {
            cb(require(script), require(config));
            Logger.info("loaded script. [script:%s] [config:%s]", script, config);
        } catch (e) {
            Logger.warn("fail to load script. [script:%s] [config:%s] [err:%s]", script, config, e);
        }
    });
}
