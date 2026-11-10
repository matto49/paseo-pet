# Paseo Pet

把本机 Paseo 的会话状态接到 dsh-pet，保留原有桌宠造型、动画和尺寸设置。插件只负责状态联动和返回会话的菜单，不需要修改 Paseo 主程序。

## 安装与使用

需要先安装 Paseo 和 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 独立桌宠。本机使用 macOS、Paseo daemon 0.15.3、网页客户端 0.15.0 和 dsh-pet 0.4.3。点击目标是 Ego 安装的 `~/Applications/ego (lite) Apps.localized/Paseo.app`，对应站点 `http://localhost:8081/`。

在本目录安装依赖后，用 Paseo 加载插件，再打开 Paseo 客户端建立首次连接：

```bash
npm install
npm run desktop:install
paseo plugin install "$PWD" --json
```

`desktop:install` 为已安装的 dsh-pet 0.4.3 加载点击适配器，并在 `~/.paseo/pet/backups/` 备份三个原始入口文件。首次安装后需要重启桌宠；不需要重启 Paseo daemon。更换 dsh-pet 版本后应重新检查适配，脚本不会盲目修改其他版本。修改插件源文件后执行：

```bash
paseo plugin reload paseo-pet --json
```

插件自动尝试打开已有的 `~/Applications/DSH Pet.app`；如果桌宠装在别处，请先手动启动。桌宠重启后，插件会重新注册菜单并恢复状态。

双击桌宠唤起已安装的 Paseo 应用，保留它当前打开的会话。点击工作状态气泡，在这个应用窗口中切换到对应会话；完成和出错提醒保留约 10 秒，点击后进入产生提醒的会话，其他任务开始运行时不改提醒的指向。气泡也可用 Tab 聚焦后按 Enter 打开。右键菜单使用同一套应用入口。

会话跳转由 Paseo 应用中的插件接收并执行，只在 `display-mode: standalone` 的已安装窗口启用。普通浏览器标签页不领取跳转请求。应用完成导航后回报确认；超时会记录失败，不自动改成打开普通浏览器标签。该流程会重新载入当前应用页面，不影响 daemon 中运行的任务。

状态规则和读取范围见 [OVERVIEW.md](OVERVIEW.md)。联动只处理当前本机 daemon，远端主机暂未接入。多个外部程序会共用 dsh-pet 的一个 `work-status` 槽，请避免同时向该槽写入状态。

## 排查与停用

本机状态文件是 `~/.paseo/pet/status.json`；设置了 `PASEO_HOME` 时使用对应目录。`connected` 表示会话订阅已经建立，`error` 记录最近一次桌宠同步失败。`navigation` 保存当前气泡的会话链接。`open-client.json` 记录已安装应用的连接状态，`open-result.json` 记录最近一次应用内跳转回执；桌宠点击成功后写入 `navigation-events.jsonl`。可先检查插件和日志：

```bash
paseo plugin ls paseo-pet --json
paseo plugin logs paseo-pet --json
```

桌宠运行信息默认来自 `~/.dsh/dsh-pet/standalone-runtime.json`，也支持 `DSH_HOME`。该文件含本机访问令牌，不要公开。尺寸仍在 dsh-pet 设置中修改，插件不覆盖它。

停用插件会移除 Paseo 菜单、清空它写入的外部工作状态，并关闭双击和气泡的 Paseo 跳转；桌宠仍可独立运行：

```bash
paseo plugin disable paseo-pet --json
```

重新启用使用 `paseo plugin enable paseo-pet --json`。完全移除插件配置使用 `paseo plugin remove paseo-pet --json`。

## 开发与来源

检查命令为 `npm run typecheck`、`npm run lint` 和 `npm test`。测试覆盖并发会话、权限解除、过期和取消、分页、订阅重连，以及通过真实本地 HTTP 服务验证桌宠令牌轮换和失败重试。

本仓库代码采用 MIT 许可，见 [LICENSE](LICENSE)。本项目是独立的 Paseo 适配插件，桌宠显示由 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提供。本仓库没有复制上游宠物素材。上游代码采用 MIT 许可，素材禁止商用，二创在公开渠道需署名；使用和分发时还应遵守各素材原作者的授权要求。
