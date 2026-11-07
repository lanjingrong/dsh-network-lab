# HCIA-Datacom 实验学习路线（由易到难）

> 这份路线已经内置进 `dsh-network-lab` 插件（`netlab_curriculum` 工具），
> 也可以在 DSH 里直接说“我的 HCIA 学习路线是什么”让 AI 按进度带你走。
>
> 总周期：约 6-8 周（每天 2 小时）。每个阶段 = 概念 → 实验 → 验证 → 自测。

---

## 总览

| 阶段 | 内容 | 难度 | 用时 | 配套实验 | 核心命令 |
| --- | --- | --- | --- | --- | --- |
| phase-0 | 环境、登录与工具（设备操作 8 步） | 准备 | 1 天 | `save-compare` | `display version` |
| phase-1 | 设备基础与接口 | 入门 | 2-3 天 | `aaa-telnet` | `display ip interface brief` |
| phase-2 | VLAN 与二层 | 入门 | 3-5 天 | `vlan-basic`、`hybrid`、`stp-loop` | `display vlan` |
| phase-3 | 路由基础（静态） | 进阶 | 5-8 天 | `static-route` | `display ip routing-table` |
| phase-4 | OSPF 动态路由 | 进阶 | 5-7 天 | `ospf-single` | `display ospf peer brief` |
| phase-5 | DHCP 与访问控制 | 进阶 | 3-5 天 | `dhcp-server`、`acl-basic` | `display acl` |
| phase-6 | NAT 与广域网出口 | 进阶 | 3-5 天 | `nat-easyip` | `display nat session all` |
| phase-7 | 综合实验 | 综合 | 5-7 天 | 自建园区网 | 全部 |
| phase-8 | 故障排查专题（先问 6 个问题） | 综合 | 3-5 天 | 故障库 12 个案例 | 分层排障 7 条 |
| phase-9 | 考前冲刺 | 冲刺 | 3-5 天 | 题库 + 自检 | - |

---

## phase-0：环境、登录与工具（1 天）

**目标**：能独立启动 eNSP、登录设备、用 DSH 连上设备，并完成一次“改配置 → 验证 → 保存 → 重启确认”的完整闭环。

**概念要点**

- eNSP 拓扑、设备启动、串口/端口号（第一台 2000）；AR 路由器启动慢，要等 1-2 分钟
- VRP 三种视图：用户视图 `<HOST>` / 系统视图 `[HOST]` / 接口视图
- `quit` 退一级、`return` 回用户视图、`save` 保存
- 三种配置：running-config（内存）、saved-configuration（flash）、startup（启动加载哪个文件）
- 登录方式：console 直连 → Telnet/SSH 远程（AAA 认证）
- DSH 连接流程：`netlab_devices scan → add → netlab_exec`

**设备操作 8 步**（每步让学习者说出为什么）

| 步 | 操作 | 为什么 |
| --- | --- | --- |
| 1 | `display version` / `display device` / `display clock` | 先看清型号、版本、时间；版本决定命令是否支持 |
| 2 | `system-view` → `quit` → `return` | 提示符就是视图，视图不对命令必报错 |
| 3 | `sysname SW1` | 现场一堆 Huawei 根本不知道连的是哪台 |
| 4 | `display current-configuration` / `display saved-configuration` / `display startup` | 以后所有变更的地基 |
| 5 | `return` → `save` → `y` | save 必须在用户视图；不保存重启就白干 |
| 6 | 改 sysname 但不保存，再看 `display saved-configuration` | 亲手见过配置丢，以后才会记得保存 |
| 7 | 保存后 `reboot`，确认配置还在 | 用一次重启换一辈子记忆 |
| 8 | `display interface brief` / `display ip interface brief` | Physical 和 Protocol 都 UP 才是真可用 |

**实操任务**

1. 在 eNSP 拖出 1 台 S5700 + 1 台 PC，启动并确认提示符
2. 右键设备查看串口号，用 `netlab_devices` 添加
3. 按设备操作 8 步走一遍，每一步都要说出“为什么做”
4. 修改 `sysname`，保存，重启设备确认配置还在

**完成标准**

- [ ] 能说出三种视图的区别
- [ ] 知道 `save` 和 `display current-configuration` 的区别
- [ ] 能说出 running-config 和 saved-configuration 分别存在哪里
- [ ] 能在 eNSP 里找到设备的串口号

---

## phase-1：设备基础与接口（1-2 天）

**目标**：能配置接口地址、看懂接口状态、知道 `shutdown` / `no shutdown`。

**概念要点**

- 接口物理状态 UP/DOWN 与协议状态
- IP 编址：掩码、网关、直连路由
- `display interface brief` / `display ip interface brief`
- 设备型号差异：S5700 只有二层口，AR 路由器是三层口

**实操任务**

1. 给两台路由器互联接口配 IP（/30 或 /24），确认直连路由出现
2. 故意 `shutdown` 一个接口，观察路由表变化，再 `no shutdown` 恢复
3. 配置 `loopback0`，观察它始终 UP 的特性

**验证**

```text
display ip interface brief
```

**完成标准**

- [ ] 能解释 `interface brief` 中 Physical / Protocol 两列
- [ ] 知道 loopback 为什么不会 DOWN

---

## phase-2：VLAN 与二层（3-5 天）

**目标**：掌握 access / trunk / hybrid、VLAN 间隔离与互通、STP 防环。

**概念要点**

- 广播域与 VLAN、PVID
- access 收无标签帧打 PVID；trunk 透传带标签帧
- VLANIF 三层接口实现 VLAN 间路由
- STP 选举根桥、端口角色 ROOT / DESI / ALTE

**实操任务**

1. 做 `vlan-basic` 实验（access + trunk，同 VLAN 跨交换机互通）
2. 加做：用 VLANIF 让 VLAN 10 和 20 互通（单臂路由或三层交换机）
3. 做 `stp-loop` 实验（三角环路，指定根桥，观察阻塞端口）
4. 手动制造故障：trunk 不放行 VLAN 20，观察现象

**命令骨架**

```text
vlan batch 10 20
interface GigabitEthernet0/0/1
 port link-type access
 port default vlan 10
interface GigabitEthernet0/0/24
 port link-type trunk
 port trunk allow-pass vlan 10 20
display vlan
display port vlan active
```

**完成标准**

- [ ] 能画出一个帧在 access→trunk→access 中的 Tag 变化
- [ ] 知道阻塞端口不是故障

---

## phase-3：路由基础（静态）（5-8 天）

**目标**：能读路由表、会写静态/缺省路由、理解最长掩码与优先级。

**概念要点**

- 路由表结构：目的网段/掩码/协议/优先级/开销/下一跳
- 静态路由、缺省路由、浮动静态路由
- 最长前缀匹配、路由优先级比较顺序
- 动态路由概述：距离矢量 vs 链路状态

**实操任务**

1. 做 `static-route` 实验（双向静态路由互通）
2. 加做缺省路由：边缘路由器写 `0.0.0.0/0` 指向 ISP
3. 加做浮动静态路由：主路由 cost 60，备路由 cost 200
4. 用 `display ip routing-table` 逐条解释字段含义

**命令骨架**

```text
ip route-static 192.168.2.0 255.255.255.0 10.0.0.2
ip route-static 0.0.0.0 0.0.0.0 200.1.1.2
display ip routing-table protocol static
```

**完成标准**

- [ ] 能解释为什么“回程路由”是双向可达的关键
- [ ] 知道浮动静态路由怎么选备

---

## phase-4：OSPF 动态路由（5-7 天）

**目标**：能配单区域 OSPF、看邻居、算开销、排邻居故障。

**概念要点**

- 邻居建立过程：Down→Init→2-Way→ExStart→Exchange→Loading→Full
- Hello / Dead 定时器、区域、router-id
- DR/BDR 选举（广播网络）
- 开销 cost = 参考带宽/接口带宽；`network` 用反掩码

**实操任务**

1. 做 `ospf-single` 实验（三台路由器 Area 0 全互通）
2. 故意改错 router-id 制造冲突，观察邻居现象
3. 故意把一台的 Area 改成 1，观察邻居无法建立
4. 用 `display ospf peer` / `display ospf interface` 解释每一行

**命令骨架**

```text
ospf 1 router-id 1.1.1.1
 area 0
  network 10.1.1.0 0.0.0.255
  network 1.1.1.1 0.0.0.0
display ospf peer brief
display ip routing-table protocol ospf
```

**完成标准**

- [ ] 能说出邻居卡在 Init 的可能原因（3 个以上）
- [ ] 能解释 cost 对选路的影响

---

## phase-5：DHCP 与访问控制（3-5 天）

**目标**：能配 DHCP 地址池、用 ACL 精准控制流量。

**概念要点**

- DHCP DORA 流程、全局地址池 vs 接口地址池
- 基本 ACL（2000-2999）只看源，高级 ACL（3000-3999）看五元组
- ACL 反掩码、规则顺序、末尾默认拒绝
- `traffic-filter` 应用点与方向

**实操任务**

1. 做 `dhcp-server` 实验（为 PC 自动分配地址、网关、DNS）
2. 做 `acl-basic` 实验（禁止 PC1 访问 Web，放行 PC2）
3. 加做：用 ACL 只允许 `192.168.1.0/24` 访问服务器，其他拒绝
4. 用 `display acl` / `display traffic-filter applied-record` 验证

**命令骨架**

```text
dhcp enable
ip pool vlan10
 network 192.168.10.0 mask 255.255.255.0
 gateway-list 192.168.10.1
acl 3000
 rule 5 deny tcp source 192.168.1.10 0 destination 192.168.2.10 0 destination-port eq 80
 rule 10 permit ip
```

**完成标准**

- [ ] 能说出末尾默认拒绝带来的坑
- [ ] 知道 ACL 应用方向怎么选

---

## phase-6：NAT 与广域网出口（3-5 天）

**目标**：能配 NAT Easy IP 让内网访问外网，会看 NAT 会话。

**概念要点**

- NAT 原理：源地址转换、地址复用
- Easy IP vs 地址池 NAT
- NAT 与 ACL、默认路由的配合
- NAT Server（端口映射）基础

**实操任务**

1. 做 `nat-easyip` 实验（内网访问外网服务器）
2. 加做：NAT Server 把公网端口映射到内网 Web
3. 用 `display nat session all` 观察转换过程
4. 故意删除默认路由，观察 NAT 会话失败

**完成标准**

- [ ] 能画出一张 NAT 转换前后的地址变化图
- [ ] 知道 NAT 配在哪里

---

## phase-7：综合实验（5-7 天）

**目标**：把 VLAN、路由、DHCP、NAT、ACL 拼成一个完整园区网。

**实操任务**

1. 自建拓扑：2 台接入 + 2 台核心 + 1 台出口路由器 + 服务器
2. 实现：VLAN 隔离、VLANIF 互通、OSPF/静态路由、DHCP 自动分配、出口 NAT
3. 用 `netlab_verify` 或手动 `display` 逐项验证
4. 画一张“数据包从 PC 到外网”的完整路径图

**完成标准**

- [ ] 能不看配置讲清整个园区的数据流
- [ ] 能在 30 分钟内从零配通

---

## phase-8：故障排查专题（3-5 天）

> 完整 12 个案例在 `netlab_fault` 工具里。**排障前先 `netlab_fault action=diagnose`，让学习者回答 6 个问题**：
> 什么层、多大范围、什么时候开始、最近改了什么、原来通不通、什么能通。

| 案例 id | 故障 | 层级 | 难度 |
| --- | --- | --- | --- |
| `f01-vlan-mismatch` | 同 VLAN 跨交换机不通：trunk 没放行 | 二层 | 初级 |
| `f02-access-pvid` | PC 接口划错 VLAN：PVID 不对 | 二层 | 初级 |
| `f03-gateway-missing` | 缺省路由缺失：内网上不了外网 | 三层 | 中级 |
| `f04-ospf-area` | OSPF 邻居卡在 Init：区域号不一致 | 三层/动态路由 | 中级 |
| `f05-acl-direction` | ACL 方向配反：本该只拦一个却全被拒 | 策略 | 中级 |
| `f06-stp-loop` | STP 被关闭导致广播风暴 | 二层 | 高级 |
| `f07-dhcp-pool` | DHCP 客户端拿不到地址 | 应用/DHCP | 初级 |
| `f08-trunk-native` | 跨厂商 trunk native VLAN 不一致 | 二层 | 高级 |
| `f09-aaa-lockout` | AAA 配错把 VTY 锁死，远程登录全断 | 管理面 | 中级 |
| `f10-save-lost` | 改完没保存，重启后配置全丢 | 配置管理 | 初级 |
| `f11-vlanif-shutdown` | VLANIF 配对了但接口是 shutdown | 三层 | 中级 |
| `f12-compound-nat` | 复合故障：NAT 没命中 + ACL 顺序错 | 策略 | 高级 |

**分层排障 7 条**（按顺序，每层一条命令证伪）

```text
1. display interface brief            # 物理/接口
2. display vlan                       # 二层
3. display port vlan active           # PVID/trunk
4. display arp                        # 三层邻居
5. display ip routing-table           # 路由
6. display acl / display nat session  # 策略
7. ping / tracert                     # 数据面
```

**训练方法**

1. 用 `netlab_fault action=diagnose` 先过 6 个问题，再用 `action=list` 选案例
2. `action=show` 只看症状，自己排查（默认已附带 3-4 道配套题）
3. 找到根因后 `action=answer` 对答案
4. **练完就测**：用工具返回的 `quizId` 直接 `netlab_quiz action=grade`；只讲不测不算学会
5. 想练真实故障环境：`action=answer inject=true bindings=[...]`（会改配置，需同意）

**完成标准**

- [ ] 能背出 7 条分层排障命令
- [ ] 知道 ping 通但业务不通的可能原因（3 个）
- [ ] 每个故障案例配套题正确率 ≥ 80%

---

## phase-9：考前冲刺（3-5 天）

**目标**：刷题 + 模拟实验，查漏补缺。

**考点梳理**

网络基础、设备管理、VLAN、STP、路由（静态/OSPF）、DHCP、NAT、ACL、广域网、IPv6 基础。

**冲刺计划**

| 天 | 上午 | 下午 |
| --- | --- | --- |
| D1 | 全部阶段 `netlab_skillcheck` 自检 | 错题对应实验重做 |
| D2 | `netlab_quiz` 10 题 | 综合实验限时 60 分钟 |
| D3 | `netlab_quiz` 10 题 | 故障案例随机 3 个 |
| D4 | 错题本复盘 | 综合实验再测一次 |
| D5 | 轻量复习 | 休息 |

**完成标准**

- [ ] 正确率稳定在 80% 以上
- [ ] 能独立完成综合实验

---

## 如何在 DSH 里用这条路线

```text
1. netlab_curriculum action=list        # 看完整路线
2. netlab_curriculum action=next        # 拿当前阶段任务
3. netlab_curriculum action=phase phase=phase-2   # 跳到某阶段
4. 做完后用 netlab_quiz 自测
5. netlab_curriculum action=complete phase=phase-2 # 标记完成
6. netlab_curriculum action=progress    # 看进度
```

也可以直接对话：

```text
我的 HCIA 学到哪了？下一步学什么？
```

AI 会先看进度，再给当前阶段和本周任务，不会一次倒出全部 10 个阶段。

---

## 注意事项

- 进度会持久化到 `%DSH_HOME%\network-lab\progress.json`，重启 DSH 不丢失；也可用 `DSH_NETLAB_PROGRESS` 指定路径
- `phase-7` 综合实验和 `phase-9` 冲刺没有内置验证项，需要自己用 `display` 判断
- 故障注入会改设备配置，注入前会要求你确认
- 所有实验基于华为 VRP；eNSP 行为与真机可能有差异
