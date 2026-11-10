# dsh-network-lab

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的网络工程实验插件：把 eNSP 里的华为交换机/路由器接进对话，让 Agent 能真实执行 VRP 命令、带你做实验、自动验证，并用题库复习。

> 不是“生成一段配置”的 prompt 集合，而是带 **Telnet 会话、设备清单、实验库、自动验证、选择题题库** 的 Host 插件。
>
> 第一次使用请看更详细的 **[使用说明.md](使用说明.md)**；照着 **[从仓库安装后的 8 组练习.md](从仓库安装后的 8 组练习.md)** 走一遍能吃透插件。
>
> 版本变化见 **[CHANGELOG.md](CHANGELOG.md)**。

![tests](https://img.shields.io/badge/tests-77%20passed-3fb950) ![Node](https://img.shields.io/badge/Node-%3E%3D20-339933) ![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.5-4B32C3) ![eNSP](https://img.shields.io/badge/eNSP-Huawei%20VRP-C7000B) ![license](https://img.shields.io/badge/license-MIT-blue)

## 一句话上手

```powershell
git clone https://github.com/lanjingrong/dsh-network-lab.git
cd dsh-network-lab
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

完全退出 DSH 再启动，新建会话；在 eNSP 里把设备开机，然后对 Agent 说一句 **“扫描 eNSP 端口并连上第一台设备”**。

## 它能做什么

| 能力 | 说明 |
| --- | --- |
| eNSP 连接 | 扫描 `127.0.0.1:2000-2020`，保存设备（host/port/username/password），保持 Telnet 会话 |
| 真实命令执行 | `netlab_exec` 逐条发送 VRP 命令，处理分页 `---- More ----`、登录、`save` 确认，返回原始输出 |
| 安全护栏 | 默认拒绝 `reboot`、`reset saved-configuration`、`format`、`delete` 等破坏性命令；需显式 `allowDestructive=true` |
| HCIA 学习路线 | `netlab_curriculum` 内置 10 阶段路线，phase-0 含“设备操作 8 步”，进度持久化，支持阶段备注 |
| 10 个内置实验 | VLAN/Trunk、静态路由、OSPF、NAT、ACL、DHCP、STP、**AAA 登录**、**配置保存与恢复**、**Hybrid** |
| 故障排查库 | `netlab_fault` **12 个**案例（含复合故障），先问 6 个问题再分层排查，可注入真实故障，**默认附带配套题** |
| 踩坑知识库 | 20 条 eNSP/华为现场坑点；`netlab_exec` 失败时自动附“你可能踩了这些坑”，`netlab_reference` 可查可贴报错匹配 |
| 安全重启验证 | `netlab_reboot` 两阶段（preflight 出保存一致性清单 → confirm 重启），重启后自动轮询端口并跑自检 |
| 命名与规范 | `netlab_standard` 生成 sysname/description、VLAN 规划，评审配置挑现场问题 |
| 变更检查卡 | `netlab_checklist` 变更前/中/后与排障检查表，带命令与红线 |
| 能力自检 | `netlab_skillcheck` 按阶段生成检查清单，找薄弱项 |
| 自动验证 | `netlab_verify` 按实验的 `display` 检查项判定通过/失败 |
| 分级提示 | `netlab_lab action=hint` 逐级给提示，`solution` 才给参考配置 |
| 选择题 | `netlab_quiz` 生成/批改，覆盖 VLAN、STP、OSPF、路由、NAT、ACL、DHCP、ARP、子网划分；**支持按故障出题** |
| 命令速查 | `netlab_reference` 离线查询常用配置与分层排障 |
| 带教经验 | `带教笔记.md`：eNSP 20 个坑、新人 5 个“我以为”、师傅话术；自动注入系统提示 |

## 环境要求

- DSH Desktop `0.2.1-rc.3` 及以上（本包在 `0.2.1-rc.5` 上开发和测试）。
- Node.js 20+（DSH 自带运行时即可）。
- 华为 eNSP，设备已启动，且能通过 Telnet 访问其串口/端口。
- 目前连接协议只支持 **Telnet**（eNSP 的设备控制台端口就是 Telnet；SSH 不是本版本目标）。

## 安装

### 方式 A：一键脚本（推荐，Windows）

先拿到代码（任选一种）：

```powershell
# git clone
git clone https://github.com/lanjingrong/dsh-network-lab.git
cd dsh-network-lab

# 或者：在 GitHub 页面点 Code → Download ZIP，解压后 cd 进去
```

然后执行安装脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：

1. 备份 profile 的 `package.json` 和 `cordis.patch.yml`；
2. 写入 `link:` 依赖并把 `dsh-network-lab` 加入 `dsh.profile.bundles`；
3. 追加 `cordis.patch.yml` 的插件行；
4. 在 `node_modules` 下建立目录联接；
5. 把 `network-lab` Skill 复制到 `%DSH_HOME%\skills\network-lab`。

然后 **完全退出并重新启动 DSH**，新建会话。侧边栏不需要新增页面，工具会直接出现在新会话中。

如果使用非 `desktop` profile：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile <name>
```

### 方式 B：手动安装

1. 把本目录放到一个稳定位置（例如 `C:\Users\laola\.dsh\plugins\dsh-network-lab`）。
2. 编辑 `%DSH_HOME%\profiles\desktop\package.json`：

```json
{
  "dependencies": {
    "dsh-network-lab": "link:C:\\Users\\laola\\.dsh\\plugins\\dsh-network-lab"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dshmarket",
        "dsh-network-lab"
      ]
    }
  }
}
```

3. 编辑 `%DSH_HOME%\profiles\desktop\cordis.patch.yml`，追加：

```yaml
- insert:
    - id: dsh-network-lab
      name: 'dsh-network-lab'
      config: {}
```

4. 在 profile 目录执行安装（让 `link:` 依赖落盘）：

```powershell
node "$env:DSH_HOME\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install
```

5. 重启 DSH。

> 不想运行 pnpm 时，也可以在 `node_modules` 下手动建立指向本目录的 Junction。`install.ps1` 就是这么做的。

### 方式 C：DSH 插件管理器

如果当前 DSH 版本暴露了 `plugin_manager` 工具，在 Creator/允许安装的预设中执行：

```text
plugin_manager action=install_bundle target=<仓库克隆的绝对路径>
```

然后刷新页面。Host 侧新路由/工具通常仍需重启 DSH 才稳定。

## 连接 eNSP

> 下文的 `netlab_*` 命令**全部在 DSH 对话框输入**，由 Agent 调用插件执行；不要敲进 eNSP 控制台或 PowerShell。
> eNSP 里双击设备弹出的窗口才是“手动敲 VRP 命令”的地方。

### 1. 找到端口

eNSP 中右键设备 → **设置** → 查看“串口/端口号”。第一台设备通常是 `2000`，后续设备依次递增。也可以直接让插件扫描：

```text
netlab_devices action=scan
```

扫描 `127.0.0.1:2000-2020`，返回开放端口和提示符预览。

### 2. 保存设备

```text
netlab_devices action=add id=sw1 name=SW1 port=2000
```

有登录认证时追加 `username=... password=...`。密码写入本机设备文件，不会在工具返回中回显。

### 3. 验证连接

```text
netlab_exec device=sw1 commands=["display version", "display clock"]
```

看到真实 VRP 输出即连接成功。

### 4. 做实验

```text
netlab_lab action=list
netlab_lab action=show lab=vlan-basic
netlab_devices action=scan
netlab_verify lab=vlan-basic bindings=[{"role":"SW1","device":"sw1"},{"role":"SW2","device":"sw2"}]
```

PC 上的数据面测试（`ping`）在 eNSP 里双击 PC 的命令行执行。

更多输入位置说明见 [使用说明.md 开头](使用说明.md)。

## 工具

| 工具 | 用途 | 关键参数 |
| --- | --- | --- |
| `netlab_curriculum` | HCIA 10 阶段学习路线：每个阶段挂好主实验/扩展实验/故障案例/自测题，带过关校验，进度持久化 | `action`, `phase`, `note`, `force` |
| `netlab_fault` | 12 个故障案例，先问 6 个问题，可注入真实故障，自动附配套题 | `action`, `id`, `level`, `layer`, `inject`, `bindings`, `quiz` |
| `netlab_standard` | 华为命名与编号规范：生成 sysname/description、VLAN 规划、配置评审 | `action`, `site`, `role`, `index`, `config` |
| `netlab_checklist` | 变更前/中/后与排障检查卡，或按实验生成 | `action`, `id`, `lab` |
| `netlab_skillcheck` | 按阶段生成能力自检清单 | `phase` |
| `netlab_devices` | 设备清单/添加/删除/扫描/adopt 一键导入/断开会话 | `action`, `id`, `host`, `port`, `username`, `password`, `newPort`, `newId`, `newName` |
| `netlab_exec` | 执行 VRP 命令，保持会话；失败自动附坑点提示 | `device`, `commands`, `save`, `newSession`, `allowDestructive` |
| `netlab_reboot` | 安全重启验证：preflight 清单 → confirm 重启 → 重启后自检 | `device`, `phase`, `confirm`, `check`, `waitMs` |
| `netlab_lab` | 10 个实验的任务书/提示/参考配置 | `action`, `lab`, `hintIndex` |
| `netlab_verify` | 自动验证实验 | `lab`, `bindings` |
| `netlab_quiz` | 生成/批改选择题，可按故障出题 | `action`, `topics`, `count`, `quizId`, `answers`, `fault` |
| `netlab_reference` | 常用命令速查、分层排障、`topic=pitfall` 查 20 条踩坑经验 | `topic`, `query` |

完整路线见 [HCIA学习路线.md](HCIA学习路线.md)，带教经验见 [带教笔记.md](带教笔记.md)。

### 示例：一次完整的 VLAN 实验

```text
1. netlab_devices action=scan
2. netlab_devices action=adopt port=2000（或 netlab_devices action=add id=sw1 name=SW1 port=2000）
3. netlab_devices action=add id=sw2 name=SW2 port=2001
4. netlab_lab action=show lab=vlan-basic
5. netlab_exec device=sw1 commands=["system-view", "sysname SW1", "vlan batch 10 20"]
6. netlab_exec device=sw1 commands=["display vlan"]
7. netlab_verify lab=vlan-basic bindings=[{"role":"SW1","device":"sw1"},{"role":"SW2","device":"sw2"}]
```

## 设备文件

实际路径以 `netlab_devices action=list` 返回的“配置文件”为准。常见有两种：

```text
%DSH_HOME%\network-lab\devices.json
%DSH_HOME%\profiles\<profile>\.dsh\network-lab\devices.json
```

第二种出现在 DSH Host 进程以 profile 目录为工作目录、且没有带 `DSH_HOME` 的情况。两种位置都可用，不要手动混用。

可用环境变量强制指定：

```powershell
$env:DSH_NETLAB_DEVICES = "D:\labs\devices.json"
```

学习进度保存在同目录的 `progress.json`，可用 `DSH_NETLAB_PROGRESS` 单独覆盖：

```json
{
  "version": 1,
  "completed": ["phase-0", "phase-1"],
  "notes": { "phase-2": "trunk 放行顺序还要练" },
  "updatedAt": "2026-11-05T09:00:00.000Z"
}
```

格式：

```json
{
  "version": 1,
  "devices": [
    {
      "id": "sw1",
      "name": "SW1",
      "host": "127.0.0.1",
      "port": 2000,
      "protocol": "telnet",
      "username": "",
      "password": "",
      "notes": "",
      "updatedAt": "2026-11-02T12:00:00.000Z"
    }
  ]
}
```

> 密码以明文保存在该 JSON 中（POSIX 下会尝试 `chmod 600`）。这是本地实验便利性设计，不要用于生产设备；生产环境建议用 SSH 插件/堡垒机，并把实验密码与真实密码分开。

## eNSP 排障

| 现象 | 优先检查 |
| --- | --- |
| 扫描不到端口 | 设备是否启动；端口号是否为 2000；eNSP 是否以管理员权限运行；是否被安全软件拦截 |
| 端口开放但连上没输出 | 设备还在启动；先等 10-30 秒；在 eNSP 控制台按回车看是否有提示符 |
| 连接被重置/占用 | 同一串口只允许一个客户端，关闭 SecureCRT/PuTTY/其他 DSH 会话 |
| 要求用户名/密码 | 设备配置了 AAA；在 `netlab_devices action=add` 中补 `username/password`，或先在 eNSP 控制台配置 |
| 命令超时 | 用 `newSession=true` 重连；确认命令没有进入分页/确认交互；必要时 `netlab_devices action=disconnect id=...` |
| 保存失败 | `save` 需要在用户视图；先 `return`/`quit` 回到 `<HOST>`，再 `save` |

## 安全边界

- 插件只在 Host 进程内运行，不向第三方服务上传设备信息或命令输出。
- 默认拒绝破坏性命令；`allowDestructive=true` 只应由用户在明确知情后授权。
- `netlab_exec` 不会自动执行 `save`，除非调用方显式传 `save=true`。
- Telnet 本身是明文协议；仅建议用于本机 eNSP 实验，不要暴露到公网。
- 设备文件含明文密码；请勿提交到 Git。

## 提示词与 Skill

- 自动系统提示：`prompts/system.md`，安装后由插件注入。
- 可复制用户提示词：`PROMPTS.md`（连接 eNSP、实验教练、排障、测验、概念课、45 分钟课程）。
- 工作区 Skill：`.dsh/skills/network-lab/SKILL.md`，DSH 会自动发现；安装脚本也会把 `skills/network-lab` 复制到 `%DSH_HOME%\skills\network-lab`，供所有会话使用。

## 开发与测试

```powershell
cd dsh-network-lab
npm run check   # node --check：index.js 与核心模块的语法检查
npm test        # 逐个文件跑 test/*.test.js，汇总通过/失败
```

> 不要用 `node --test`：在部分 Windows 沙箱里子进程会被拒绝（`spawn EPERM`），所以 `test/run-all.mjs` 逐个文件调用 node 并核对输出。

测试覆盖：

- Telnet 选项协商、提示符识别、分页/回显清理、登录、`save` 确认；
- 中文编码识别：GBK 与 UTF-8 自动判别、逐字节拆分不吞字、乱码名修复；
- 设备/进度文件的原子写入（12 次连写不留 `.tmp`、写入之间文件始终可读）；
- 踩坑知识库：VRP 原始报错优先、口语化描述也能匹配、过宽正则不误报；
- 插件工具注册、输出 schema、实验/题库/参考内容；
- 用模拟 eNSP Telnet 服务器跑通 `netlab_exec` 和 `netlab_verify`。

> 当前开发环境没有运行 eNSP，因此真实设备只做了协议级模拟测试；首次连接真实 eNSP 时请先用 `display version` 验证。

## 目录

```text
dsh-network-lab/
├─ index.js              # 插件入口：12 个工具 + 系统提示注入
├─ lib/
│  ├─ telnet.js          # Telnet 协议、编码识别（UTF-8/GB18030）、会话、登录、分页、save、reboot
│  ├─ store.js           # 设备清单与学习进度持久化（原子替换写）
│  ├─ labs.js            # 10 个实验的任务/提示/参考配置/验证项
│  ├─ curriculum.js      # HCIA 10 阶段路线与设备操作 8 步
│  ├─ faults.js          # 12 个故障案例 + 排障 6 问
│  ├─ faultquiz.js       # 故障 → 题目联动
│  ├─ knowledge.js       # 20 条踩坑知识库与报错匹配
│  ├─ standard.js        # 华为命名/编号规范与配置评审
│  ├─ checklist.js       # 变更前/中/后与排障检查卡
│  ├─ quiz.js            # 题库与批改
│  └─ reference.js       # 命令速查
├─ prompts/system.md     # 自动注入的教学提示
├─ PROMPTS.md            # 可复制用户提示词
├─ 使用说明.md           # 详细上手/排障/速查手册
├─ HCIA学习路线.md       # 10 阶段完整路线
├─ 带教笔记.md           # eNSP 20 个坑 + 新人话术
├─ skills/network-lab/SKILL.md
├─ CHANGELOG.md          # 版本变更记录
├─ 从仓库安装后的 8 组练习.md  # 复制粘贴即可的连续练习
├─ LICENSE               # MIT
├─ .gitignore
├─ test/                 # 77 个测试 + run-all.mjs 跑全部
```

## 兼容性

| | 要求 |
| --- | --- |
| DSH | `>=0.2.1-rc.3 <0.3.0`（开发于 `0.2.1-rc.5`） |
| Node | `>=20` |
| 平台 | Windows（主要验证平台）；Telnet 代码本身跨平台 |
| eNSP | 华为 eNSP，设备 Telnet 控制台端口可达 |

## License

MIT
