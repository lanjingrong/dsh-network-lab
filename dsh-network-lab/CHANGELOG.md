# 变更记录

版本号遵循 `MAJOR.MINOR.PATCH`：新工具或行为变化 → MINOR，修 bug → PATCH。

## 0.8.0

- 新增 `netlab_quiz action=retry`：**错题重做**。批改后只说一句“再考我一遍错的”，插件就把上次做错的题挑出来重出一份新测验：
  - 只出错题，对的题不再出现；
  - **选项顺序打乱**，上次记住的“答案是 B”作废，必须真懂才能再对；
  - 不传 `quizId` 默认重做最近一次批改；
  - 重做全对提示“讲一遍为什么”，没全对列出还剩哪几道、提示先回去看知识点。
- 批改未全对时，结果末尾直接给出 `netlab_quiz action=retry quizId=...` 的重做入口。
- 新增 `lib/retry.js`（`buildRetryQuiz` / `retryMarkdown` / `retryBackNote`）与 `test/retry.test.js`（8 个用例）。
- 测试 85 → 93。

## 0.7.1

- **改进**：`netlab_verify` 新增 `auto` 参数，`bindings` 不再是必填。
  - `netlab_verify lab=vlan-basic auto=true`：按当前设备表自动配对角色，不用再手写 `bindings=[{"role":"SW1","device":"sw1"}]`。
  - 配对规则：角色名（`SW1`/`R1`/`AR1`）先匹配设备 id、再匹配设备名称（不分大小写）；没命中就按设备表顺序顺延；配不上的角色标 `skip`。
  - 返回结果第一行会写明“自动绑定：SW1 → sw1，R1 → r1”，学生能看见到底连了哪台。
  - 手工 `bindings` 仍然可用，需要一台设备扮演两个角色时就用它。
  - 不新增工具，仍是 12 个；不影响其它工具行为。
- 测试 77 → **85**（新增 `test/autobind.test.js` 8 个）。

## 0.7.0

- **新功能**：`netlab_devices action=adopt` —— 一键导入未登记的开放端口。
  - `adopt port=2004`：探一次端口，按提示符自动识别型号（`S5700-*` → 交换机，`USG*` → 防火墙，`AR*/R*` → 路由器），写入设备表。
  - 不写端口：在扫描范围（默认 2000-2020）里找“开放但未登记”的端口并列出来。
  - 四种情况都不瞎写：有提示符才导入；`Username:/Password:` 返回登记命令；端口通但无提示符提示“还在开机”；端口/id 已占用直接报错。
  - 不新增工具，仍是 12 个。
- `netlab_devices action=scan` 无结果时改引导 `action=adopt`。
- `lib/telnet.js` 新增 `vrpModel()`（认型号）与 `loginHint()`（登录指引）。
- 测试 70 → **77**（新增 `test/adopt.test.js` 7 个）。
- 仓库化：`.gitignore`、`npm test`（`test/run-all.mjs` 逐文件跑）、`npm run check`、`LICENSE`、本文件、`从仓库安装后的 8 组练习.md`。
- 修 `install.ps1` 结尾仍写“六个工具”的旧文案，并确保带 BOM（Windows PowerShell 5.1 才能正确解析中文）。

## 0.6.0

- **学习闭环打通**：阶段 → 实验 → 故障 → 题目双向关联，`netlab_curriculum` 的 `progress / next / phase` 会告诉你“下一步做什么”。
- 阶段过关校验：主实验 `netlab_verify` 全绿 + 该阶段题目正确率 ≥ 80% 才算完成；`complete` 未过关时拒绝，需要显式 `force=true`。
- `netlab_verify` 成功后自动记录，`netlab_quiz action=grade` 后提示“可以标记阶段完成”。
- `findPhase` 支持只写数字（`2` → `phase-2`）。

## 0.5.1

- **修 GBK 乱码**：设备名/中文 description 登录后变 `瀛︿範鏈…`。改为“先按可见字节回放，编码定下来后整段重放”，中文逐字节拆分不再吞字。

## 0.5.0

- 20 条 eNSP/华为踩坑知识库；`netlab_exec` 失败时自动附“你可能踩了这些坑”，`netlab_reference topic=pitfall` 可查可贴报错匹配。
- 故障“练完就测”：`netlab_fault` 默认附 3-4 道配套题，`netlab_quiz action=fault`。
- `netlab_reboot`：两阶段安全重启（preflight 比对 current/saved → confirm 重启 → 轮询恢复 → 跑自检，判定配置是否真正落盘）。

## 0.4.0

- 实验扩到 10 个（新增 `aaa-telnet`、`save-compare`、`hybrid`），每个实验补 `devices` / `prereq` / `why`。
- 新工具：`netlab_standard`（sysname/description/VLAN 规划/配置评审）、`netlab_checklist`（变更前中后与排障检查卡）。
- 故障库扩到 12 个（含复合故障 `f12-compound-nat`），新增 `action=diagnose` 的排障 6 问。
- `带教笔记.md`：eNSP 20 个坑、新人 5 个“我以为”、师傅话术。

## 0.3.0

- 学习进度持久化到 `progress.json`（与 `devices.json` 同目录，`DSH_NETLAB_PROGRESS` 可覆盖）；并发写入串行化，重启可恢复。

## 0.2.0

- HCIA 10 阶段路线（`netlab_curriculum`）、12 故障库骨架（`netlab_fault`）、能力自检（`netlab_skillcheck`）。

## 0.1.0

- 首个版本：`netlab_devices` / `netlab_exec` / `netlab_lab` / `netlab_verify` / `netlab_quiz` / `netlab_reference`，Telnet 会话、设备清单、7 个实验、题库。
