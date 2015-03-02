/**
 * Misaka 的分布式存储。
 */
"use strict";

var _ = require("underscore");
var debug = require("debug")("misaka");
var setImmediate = require("timers").setImmediate;

var SAVER_RETRY_INTERVAL = 5000; // 单位毫秒

/**
 * 用初始化一个 Misaka brain，提供一个用来保存的回调。
 * @param {Function} saver function(values, cb)
 * @constructor
 */
function Brain(saver) {
    this._saver = saver;
    this._values = {};
    this._patches = {};

    this._saving = false;
    this._dirty = false;
}

module.exports = require("./event_source")(Brain);

/**
 * 使用指定的数据覆盖本地数据。
 * @param values
 * @param {Boolean} [muteEvent]
 */
Brain.prototype.load = function(values, muteEvent) {
    var hasChange = false;
    var changes;

    if (!muteEvent) {
        changes = {};

        _.each(values, function(value, key) {
            // 如果新值没有被 patch 且与原来不同，说明变化了。
            var hasPatch = this._patches.hasOwnProperty(key);
            var hasValue = this._values.hasOwnProperty(key);
            var different = hasValue && !_.isEqual(value, this._values[key]);
            var notExist = !hasValue && value !== undefined;
            var change = hasPatch && (different || notExist);
            changes[key] = change;
            hasChange = hasChange || change;
        }, this);

        _.each(this._values, function(value, key) {
            if (changes.hasOwnProperty(key)) {
                return;
            }

            // 如果以前存在的值现在被删除了，也认为变化了。
            var change = !this._patches.hasOwnProperty(key);
            changes[key] = change;
            hasChange = hasChange || change;
        }, this);
    }

    this._values = values || {};

    if (hasChange) {
        _.each(changes, function(change, key) {
            if (change) {
                this.emit("change:" + key, this.get(key));
            }
        }, this);
        this.emit("change");
    }

    return this;
};

/**
 * 读取一个值，如果 key 对应的值不存在则返回 defValue。
 * @param {String} key
 * @param [defValue]
 */
Brain.prototype.get = function(key, defValue) {
    var value = defValue;
    var patch;

    if (this._values.hasOwnProperty(key)) {
        value = this._values[key];
    }

    if (this._patches.hasOwnProperty(key)) {
        patch = this._patches[key];

        switch (patch.action) {
            case "set":
                value = patch.value;
                break;

            case "del":
                value = defValue;
                break;
        }
    }

    return value;
};

/**
 * 设置 key 对应的值。
 * @param key
 * @param value
 */
Brain.prototype.set = function(key, value) {
    this._patches[key] = {
        action: "set",
        value: value
    };
    this._dirty = true;
    this.save();

    this.emit("change:" + key, value);
    this.emit("change");
    return this;
};

/**
 * 删除一个 key。
 * @param {String} key
 */
Brain.prototype.del = function(key) {
    this._patches[key] = {
        action: "del"
    };
    this._dirty = true;
    this.save();

    this.emit("change:" + key);
    this.emit("change");
    return this;
};

/**
 * 标记当前有需要保存的内容，延时保存数据。
 */
Brain.prototype.save = function() {
    if (this._saving || !this._dirty) {
        return this;
    }

    this._saving = true;

    var me = this;
    setImmediate(function() {
        savePatches(me);
    });
    return this;
};

function savePatches(brain, unsavedPatches) {
    var values = brain._values;
    var patches = brain._patches;

    brain._patches = {};
    brain._dirty = false;

    // 应用 patch 到 value。
    _.each(patches, function(value, key) {
        switch (value.action) {
            case "set":
                values[key] = value.value;
                break;

            case "del":
                delete values[key];
                break;
        }
    });

    // 如果存在未保存的 patch，合并当前的和未保存的。
    if (unsavedPatches) {
        _.extend(unsavedPatches, patches);
        patches = unsavedPatches;
    }

    brain._saver(patches, function(err, values) {
        if (err) {
            debug("fail to apply brain patches. [err:%s]", err);
            setTimeout(function() {
                savePatches(brain, patches);
            }, SAVER_RETRY_INTERVAL);
            return;
        }

        brain._saving = false;
        brain.load(values, true);

        if (brain._dirty) {
            brain.save();
        }
    });
}

