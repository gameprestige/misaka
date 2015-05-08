# Misaka - 御坂网络中的御坂妹妹 #

## 故事 ##

[御坂妹妹](http://baike.baidu.com/view/2920862.htm)是《魔法禁书目录》和《某科学的超电磁炮》这两部小说中登场的角色，她们全员都是[御坂美琴](http://baike.baidu.com/view/1902239.htm)的克隆体，拥有 Level 2 至 Level 4 的超能力。

单个御坂妹妹并没有太强能力，但由近万个御坂妹妹组成的御坂网络（The Sisters）则是相当恐怖的存在，它不光承载了学园都市最强超能力者[一方通行](http://baike.baidu.com/view/2110758.htm)的全部计算量，还具有将御坂美琴直接提升到[绝对能力者](http://baike.baidu.com/view/5273493.htm)的能力，可以说是科学侧当前最为逆天的存在。

御坂网络的架构很简单：

* 网络的核心是“最后之作”（Last Order），负责管理每一个御坂妹妹的状态，相当于一个中央控制器；
* 每个御坂妹妹通过私有协议连接到“最后之作”，共享所有的记忆和运算能力。

在 Game Prestige，御坂网络是运维的伙伴，负责实时汇报服务器状态，或者执行规定好的命令。

## 使用御坂网络 ##

### 安装和运行 ###

要在本地运行御坂网络非常简单，只需要以下步骤。

1. 在一个目录初始化 npm

        mkdir my-misaka
        cd my-misaka
        npm init

2. 获取 Misaka 代码

        npm install --save misaka

3. 随手写一个可以工作的 Misaka 脚本

        mkdir scripts
        cat > scripts/hello.js <<EOF
        module.exports = function(misaka) {
            misaka.send("Hello, everyone!");
        }
        EOF

3. 启动 Misaka

        node_modules/.bin/misaka

### 与御坂网络交互 ###

一旦 Misaka 开始运行，Last Order 的命令行就能立即收到消息，此时在 Last Order 命令行里输入 `misaka help` 就能查看详细的帮助。

默认情况下 Misaka 没有激活任何功能，可以通过输入下面的命令激活功能。激活是持久的，状态会存在 redis 里，所以一般只要做一次激活就可以永久使用。

    # 开启脚本列表。
    misaka> misaka script scripts enable

    # 查看所有支持的脚本，之后就可以通过 `misaka 10033 scripts` 查看所有可开启的脚本。
    misaka> misaka 10033 scripts
    Shell: 御坂 No.10033 情绪激动的报告说，命令执行成功，下面是详情：
    * 任务 ID：1
    ✘ 未启用：`facter`
    ✘ 未启用：`help`
    ✘ 未启用：`ping`
    ✘ 未启用：`puppet`
    ✘ 未启用：`sample`
    ✔ 已启用：`scripts`
    ✘ 未启用：`time`
    ✘ 未启用：`uptime`
    ✘ 未启用：`wolf_warn`

    # 开启新的脚本，比如 `help`。
    misaka> misaka script help enable

### 让御坂学习新脚本 ###

只需要在 Misaka 项目的 `scripts` 目录中添加新的脚本文件，重启 Misaka 后就可以通过 Last Order 开启这个脚本。

脚本文件的文件名即脚本名，比如文件名是 `foo`，那么可通过 `misaka script foo enable` 来启用。

脚本文件需要导出一个函数作为初始化函数，以 `scripts/time.js` 文件为例，基本代码结构如下：

```javascript
/**
* 报告当前服务器的时间。
*/
"use strict";

module.exports = function(misaka) {
  var time = this.channel("time", {
    usage: "time",
    help: "报告御坂当前时间",
    pattern: /^time\s*$/i
  });
  time.on("message", function(msg) {
    msg.send("当前时间是 " + new Date());
  });
};

```

其中 `this` 对象为 `Script` 类实例，类定义在 `utils/script.js`；函数参数中的 `misaka` 是 `Misaka` 类实例，类定义在 `misaka.js`。

一般只需要使用 `this` 和 `misaka` 便可以完成脚本的全部功能。

几个核心方法：

* `Script#channel`：创建一个新的命令，返回的是一个 `EventEmitter`，调用者通过 `message` 事件来获取消息，获得的 `msg` 是 `Message` 类实例，类定义在 `utils/message.js`。
* `Script#on`：监听脚本的各种消息，包括 `enabled` 和 `disabled` 两种，分布在脚本被启用和被禁用时触发。
* `Misaka#send`：主动向外部发消息，内容会显示在 Last Order 的输出里。
* `Misaka#brain`：御坂网络的中心存储，所以写入的内容会被持久化到 Last Order，每次 Misaka 连上 Last Order 时会自动读取。这个属性是 `Brain` 类实例，类定义在 `utils/brain.js`。

## 开发说明 ##

御坂网络不同于一般的代码逻辑，她们是（可以）有感情的，制作任何御坂网络脚本时应该记得一个原则：有爱。

这种“爱”体现在交互思维上，御坂通过一些命令进行交互，回答各种命令时应该带有感情，甚至最好带有御坂的语癖，让她们更有活力，更像一个真实的克隆人而不是一堆代码。

## TODOs ##

比较需要实现的功能：

* 允许单个 Misaka 接受 http 请求，从而可以作为 web hook 的响应程序；
* 利用御坂网络所在服务器的空闲资源做分布式计算；
* 御坂网络 P2P 传递信息和文件；
* 限制 Misaka 实例占用的资源，限制 Misaka 和她执行的 shell 命令占用的总 CPU/内存量。
