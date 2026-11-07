/**
 * HCIA-Datacom 实验学习路线。
 * 每条路线 = 阶段数组；每个阶段 = 概念要点 + 实验（关联内置 lab 或现场任务）+ 验证方式。
 * 设计原则：由易到难，先单机后多机，先二层后三层，先配通再排错，最后综合与考试模拟。
 */

const PHASE = (data) => data

export const CURRICULUM = [
  PHASE({
    id: 'phase-0',
    title: '第 0 阶段：环境、登录与工具（1 天）',
    level: '准备',
    days: '1 天',
    goal: '能独立启动 eNSP、登录设备、在 DSH 里连上设备，并完成一次“改配置 → 验证 → 保存 → 重启确认”的完整闭环。',
    concepts: [
      'eNSP 拓扑、设备启动、串口/端口号（第一台 2000）；AR 路由器启动慢，需要等 1-2 分钟',
      'VRP 视图：用户视图 <HOST> / 系统视图 [HOST] / 接口视图',
      'quit 退一级、return 回用户视图、save 保存、display 查看',
      '三种配置：running-config（内存）、saved-configuration（flash）、startup（启动加载哪个文件）',
      'DSH 连接：netlab_devices scan → add → netlab_exec',
      '登录方式：console 直连 → Telnet/SSH 远程（AAA 认证）',
    ],
    deviceSteps: [
      {
        title: '第 1 步：认识设备',
        commands: ['display version', 'display device', 'display clock'],
        why: '第一件事永远是看清楚这是什么型号、什么版本、当前时间。版本决定命令是否支持。',
      },
      {
        title: '第 2 步：认识视图',
        commands: ['system-view', 'quit', 'return'],
        why: '提示符就是当前视图：<x> 用户视图，[x] 系统视图，[x-GigabitEthernet0/0/1] 接口视图。',
      },
      {
        title: '第 3 步：认识命名',
        commands: ['system-view', 'sysname SW1', 'quit'],
        why: '第一件事就改名。现场看到一堆 Huawei 根本不知道连的是哪台。',
      },
      {
        title: '第 4 步：看配置',
        commands: ['display current-configuration', 'display saved-configuration', 'display startup'],
        why: '这三个命令是以后所有变更的地基：改了什么、存了什么、重启加载什么。',
      },
      {
        title: '第 5 步：保存一次',
        commands: ['return', 'save', 'y'],
        why: 'save 必须在用户视图；系统会问 [Y/N]，y 才写盘。不保存，重启就白干。',
      },
      {
        title: '第 6 步：制造一次丢配置',
        commands: ['system-view', 'sysname TEMP-TEST', 'quit', 'display saved-configuration'],
        why: '故意不保存，看 saved-configuration 里 sysname 没变。亲手见过，以后才记得。',
      },
      {
        title: '第 7 步：重启验证',
        commands: ['return', 'save', 'y', 'reboot'],
        why: '保存后重启，确认 sysname 还在。重启前一定要 save，否则前面的努力全丢。',
      },
      {
        title: '第 8 步：接口初识',
        commands: ['display interface brief', 'display ip interface brief'],
        why: 'Physical 是物理层，Protocol 是协议层。UP/UP 才是真正可用。',
      },
    ],
    tasks: [
      '在 eNSP 拖出 1 台 S5700 + 1 台 PC，启动并确认提示符',
      '右键设备查看串口号，用 netlab_devices 添加',
      '按设备操作 8 步走一遍，每一步都要说出"为什么做"',
      '修改 sysname，再保存，重启设备确认配置还在',
      '执行 display version，说出型号、版本、启动时间三个信息',
    ],
    verify: [
      { role: 'SW1', command: 'display version', expect: 'VRP|Huawei|S5700', hint: '能读到设备型号和 VRP 版本' },
      { role: 'SW1', command: 'display saved-configuration', expect: 'sysname', hint: 'saved 配置里应有 sysname，说明保存过' },
    ],
    lab: 'save-compare',
    relatedLabs: [],
    checklist: [
      '能说出三种视图的区别',
      '知道 save 和 display current-configuration 的区别',
      '能说出 running-config 和 saved-configuration 分别存在哪里',
      '能在 eNSP 里找到设备的串口号',
    ],
  }),
  PHASE({
    id: 'phase-1',
    title: '第 1 阶段：设备基础与接口（2-3 天）',
    level: '入门',
    days: '2-3 天',
    goal: '能配置接口地址、看懂接口状态、知道 shutdown/no shutdown，能让两台设备直连 ping 通。',
    concepts: [
      '接口物理状态 UP/DOWN 与协议状态',
      'IP 编址：掩码、网关、直连路由',
      'display interface brief / display ip interface brief',
      '设备型号差异：S5700 只有二层口，AR 路由器是三层口',
      '接口 description 规范：To-<对端>-<端口>',
      'loopback 接口：永远 UP，常用于 router-id 和管理地址',
    ],
    tasks: [
      '给两台路由器互联接口配 IP（/30 或 /24），确认直连路由出现',
      '故意 shutdown 一个接口，观察路由表变化，再 no shutdown 恢复',
      '配置 loopback0，观察它始终 UP 的特性',
      '给每个接口加 description，用 display interface description 检查',
      '用 netlab_standard action=review 检查自己的命名是否规范',
    ],
    verify: [
      { role: 'R1', command: 'display ip interface brief', expect: '192\\.168\\.1\\.1|10\\.0\\.0\\.1', hint: '接口应 UP 且地址正确' },
      { role: 'R1', command: 'display interface description', expect: 'To-', hint: '接口描述应写对端，方便排查' },
    ],
    lab: null,
    relatedLabs: ['aaa-telnet'],
    checklist: [
      '能解释 interface brief 中 Physical/Protocol 两列',
      '知道 loopback 为什么不会 DOWN',
      '能说出 /24 和 /30 分别有几个可用地址',
      '能给接口写出符合规范的 description',
    ],
  }),
  PHASE({
    id: 'phase-2',
    title: '第 2 阶段：VLAN 与二层（3-5 天）',
    level: '入门',
    days: '3-5 天',
    goal: '掌握 access/trunk/hybrid、VLAN 间隔离与互通、STP 防环。',
    concepts: [
      '广播域与 VLAN、PVID',
      'access 收无标签帧打 PVID；trunk 透传带标签帧',
      'VLANIF 三层接口实现 VLAN 间路由',
      'STP 选举根桥、端口角色 ROOT/DESI/ALTE',
    ],
    tasks: [
      '做 vlan-basic 实验（access + trunk，同 VLAN 跨交换机互通）',
      '加做：用 VLANIF 让 VLAN 10 和 20 互通（单臂路由或三层交换机）',
      '做 stp-loop 实验（三角环路，指定根桥，观察阻塞端口）',
      '手动制造故障：trunk 不放行 VLAN 20，观察现象',
    ],
    verify: [
      { role: 'SW1', command: 'display vlan', expect: '10|20', hint: 'VLAN 已创建且端口加入' },
      { role: 'SW2', command: 'display port vlan active', expect: '10|20', hint: 'trunk 放行了 VLAN' },
    ],
    lab: 'vlan-basic',
    relatedLabs: ['hybrid', 'stp-loop'],
    checklist: [
      '能画出一个帧在 access→trunk→access 中的 Tag 变化',
      '知道阻塞端口不是故障',
      '能说出 hybrid 和 trunk 的区别',
      '知道 VLAN 1 为什么不该承载业务',
    ],
  }),
  PHASE({
    id: 'phase-3',
    title: '第 3 阶段：路由基础（静态 + 动态）（5-8 天）',
    level: '进阶',
    days: '5-8 天',
    goal: '能读路由表、会写静态/缺省路由、理解最长掩码与优先级。',
    concepts: [
      '路由表结构：目的网段/掩码/协议/优先级/开销/下一跳',
      '静态路由、缺省路由、浮动静态路由',
      '最长前缀匹配、路由优先级比较顺序',
      '动态路由概述：距离矢量 vs 链路状态',
    ],
    tasks: [
      '做 static-route 实验（双向静态路由互通）',
      '加做缺省路由：边缘路由器写 0.0.0.0/0 指向 ISP',
      '加做浮动静态路由：主路由 cost 60，备路由 cost 200',
      '用 display ip routing-table 逐条解释字段含义',
    ],
    verify: [
      { role: 'R1', command: 'display ip routing-table protocol static', expect: '192\\.168\\.2\\.0/24', hint: '静态路由生效' },
    ],
    lab: 'static-route',
    relatedLabs: [],
    checklist: ['能解释为什么"回程路由"是双向可达的关键', '知道浮动静态路由怎么选备'],
  }),
  PHASE({
    id: 'phase-4',
    title: '第 4 阶段：OSPF 动态路由（5-7 天）',
    level: '进阶',
    days: '5-7 天',
    goal: '能配单区域 OSPF、看邻居、算开销、排邻居故障。',
    concepts: [
      'OSPF 邻居建立过程：Down→Init→2-Way→ExStart→Exchange→Loading→Full',
      'Hello/Dead 定时器、区域、router-id',
      'DR/BDR 选举（广播网络）',
      '开销 cost = 参考带宽/接口带宽；network 反掩码',
    ],
    tasks: [
      '做 ospf-single 实验（三台路由器 Area 0 全互通）',
      '故意改错 router-id 制造冲突，观察邻居现象',
      '故意把一台的 Area 改成 1，观察邻居无法建立',
      '用 display ospf peer / display ospf interface 解释每一行',
    ],
    verify: [
      { role: 'R1', command: 'display ospf peer brief', expect: 'Full', hint: '至少两个 Full 邻居' },
      { role: 'R2', command: 'display ip routing-table', expect: 'OSPF', hint: '路由表有 OSPF 协议的路由' },
    ],
    lab: 'ospf-single',
    relatedLabs: [],
    checklist: ['能说出邻居卡在 Init 的可能原因（3 个以上）', '能解释 cost 对选路的影响'],
  }),
  PHASE({
    id: 'phase-5',
    title: '第 5 阶段：DHCP 与访问控制（3-5 天）',
    level: '进阶',
    days: '3-5 天',
    goal: '能配 DHCP 地址池、用 ACL 精准控制流量。',
    concepts: [
      'DHCP DORA 流程、全局地址池 vs 接口地址池',
      '基本 ACL（2000-2999）只看源，高级 ACL（3000-3999）看五元组',
      'ACL 反掩码、规则顺序、末尾默认拒绝',
      'traffic-filter 应用点与方向',
    ],
    tasks: [
      '做 dhcp-server 实验（为 PC 自动分配地址、网关、DNS）',
      '做 acl-basic 实验（禁止 PC1 访问 Web，放行 PC2）',
      '加做：用 ACL 只允许 192.168.1.0/24 访问服务器，其他拒绝',
      '用 display acl / display traffic-filter applied-record 验证',
    ],
    verify: [
      { role: 'R1', command: 'display acl 3000', expect: 'rule 5 deny tcp', hint: '高级 ACL 已配置' },
      { role: 'R1', command: 'display ip pool', expect: '192\\.168\\.10\\.0|vlan10', hint: 'DHCP 地址池已创建' },
    ],
    lab: 'dhcp-server',
    relatedLabs: ['acl-basic'],
    checklist: ['能说出末尾默认拒绝带来的坑', '知道 ACL 应用方向怎么选'],
  }),
  PHASE({
    id: 'phase-6',
    title: '第 6 阶段：NAT 与广域网出口（3-5 天）',
    level: '进阶',
    days: '3-5 天',
    goal: '能配 NAT Easy IP 让内网访问外网，会看 NAT 会话。',
    concepts: [
      'NAT 原理：源地址转换、地址复用',
      'Easy IP vs 地址池 NAT',
      'NAT 与 ACL、默认路由的配合',
      'NAT Server（端口映射）基础',
    ],
    tasks: [
      '做 nat-easyip 实验（内网访问外网服务器）',
      '加做：NAT Server 把公网端口映射到内网 Web',
      '用 display nat session all 观察转换过程',
      '故意删除默认路由，观察 NAT 会话失败',
    ],
    verify: [
      { role: 'R1', command: 'display current-configuration | include nat', expect: 'nat outbound', hint: '出口接口调用了 NAT' },
    ],
    lab: 'nat-easyip',
    relatedLabs: [],
    checklist: ['能画出一张 NAT 转换前后的地址变化图', '知道 NAT 配在哪里'],
  }),
  PHASE({
    id: 'phase-7',
    title: '第 7 阶段：综合实验（5-7 天）',
    level: '综合',
    days: '5-7 天',
    goal: '把 VLAN、路由、DHCP、NAT、ACL 拼成一个完整园区网。',
    concepts: [
      '三层架构：接入-汇聚-核心',
      'VLAN 间路由、出口 NAT',
      '冗余与故障切换（STP、浮动路由）',
    ],
    tasks: [
      '自建拓扑：2 台接入 + 2 台核心 + 1 台出口路由器 + 服务器',
      '实现：VLAN 隔离、VLANIF 互通、OSPF/静态路由、DHCP 自动分配、出口 NAT',
      '用 netlab_verify 或手动 display 逐项验证',
      '画一张"数据包从 PC 到外网"的完整路径图',
    ],
    verify: [
      { role: 'CORE1', command: 'display ip routing-table', expect: 'OSPF|Static', hint: '核心路由表完整' },
    ],
    lab: null,
    checklist: ['能不看配置讲清整个园区的数据流', '能在 30 分钟内从零配通'],
  }),
  PHASE({
    id: 'phase-8',
    title: '第 8 阶段：故障排查专题（3-5 天）',
    level: '综合',
    days: '3-5 天',
    goal: '形成分层排障肌肉记忆，能在 10 分钟内定位常见故障；先问对问题，再敲命令。',
    concepts: [
      '排障前先问 6 个问题：什么层、多大范围、什么时候开始、最近改了什么、原来通不通、什么能通',
      '分层排障：物理→二层→三层→策略→应用',
      '每条命令都要能证伪一个假设',
      '最小改动原则：不删配置、不 reset、一次只改一个变量',
      '配置管理类故障：没 save、AAA 锁死、VLANIF shutdown',
    ],
    tasks: [
      'netlab_fault action=diagnose 背下 6 个问题，每个案例先走一遍',
      '用 netlab_fault 逐个做故障案例（12 个，含复合故障 f12）',
      '每个案例先自己判断，再对答案',
      '限时 10 分钟完成一个故障',
      '用 netlab_checklist id=troubleshoot 走一遍检查卡',
      '整理自己的排障清单',
    ],
    verify: [],
    lab: null,
    checklist: [
      '能背出 7 条分层排障命令',
      '知道 ping 通但业务不通的可能原因（3 个）',
      '能说出"部分通部分不通"要先缩小范围的三个维度',
      '知道 AAA 改错锁死时 console 是唯一退路',
    ],
  }),
  PHASE({
    id: 'phase-9',
    title: '第 9 阶段：考前冲刺（3-5 天）',
    level: '冲刺',
    days: '3-5 天',
    goal: '刷题 + 模拟实验，查漏补缺。',
    concepts: [
      'HCIA-Datacom 考点：网络基础、设备管理、VLAN、STP、路由、DHCP、NAT、ACL、广域网、IPv6 基础',
      '错题归因：概念不清 / 命令记错 / 审题失误',
    ],
    tasks: [
      'netlab_quiz 每天 10 题，错题当天复盘',
      'netlab_skillcheck 检查每个阶段是否完成',
      '重做一遍综合实验（限时 60 分钟）',
      '整理错题本',
    ],
    verify: [],
    lab: null,
    checklist: ['正确率稳定在 80% 以上', '能独立完成综合实验'],
  }),
]

export function listPhases() {
  return CURRICULUM.map((phase) => ({
    id: phase.id,
    title: phase.title,
    level: phase.level,
    days: phase.days,
    lab: phase.lab,
  }))
}

export function findPhase(id) {
  const key = String(id || '').trim().toLowerCase()
  return CURRICULUM.find((phase) => phase.id === key) || null
}

/** 计算学习进度：已完成的阶段数 / 总阶段数。completed 为阶段 id 数组。 */
export function computeProgress(completed = []) {
  const done = CURRICULUM.filter((phase) => completed.includes(phase.id))
  const pending = CURRICULUM.filter((phase) => !completed.includes(phase.id))
  return {
    total: CURRICULUM.length,
    done: done.length,
    percent: Math.round((done.length / CURRICULUM.length) * 100),
    pending,
  }
}

/** 推荐下一步：第一个未完成阶段。 */
export function nextPhase(completed = []) {
  return CURRICULUM.find((phase) => !completed.includes(phase.id)) || null
}

export function phaseMarkdown(phase, { index } = {}) {
  const parts = [
    `# ${phase.title}`,
    `**难度**：${phase.level}　**建议用时**：${phase.days}`,
    '',
    `**阶段目标**：${phase.goal}`,
    '',
    '## 概念要点',
    ...phase.concepts.map((item) => `- ${item}`),
    '',
    '## 实操任务',
    ...phase.tasks.map((item, i) => `${i + 1}. ${item}`),
  ]
  if (phase.deviceSteps && phase.deviceSteps.length) {
    parts.push('', '## 设备操作 8 步（按顺序做，每步说出为什么）')
    for (const step of phase.deviceSteps) {
      parts.push('', `### ${step.title}`, '```text', ...step.commands, '```', `> ${step.why}`)
    }
  }
  if (phase.lab) parts.push('', `## 关联实验`, `用 \`netlab_lab action=show lab=${phase.lab}\` 打开配套实验。`)
  if (phase.relatedLabs && phase.relatedLabs.length) {
    parts.push('', '## 扩展实验', ...phase.relatedLabs.map((id) => `- \`${id}\``))
  }
  if (phase.verify && phase.verify.length) {
    parts.push('', '## 验证点', '```text', ...phase.verify.map((check) => `${check.role}: ${check.command}`), '```')
  }
  if (phase.checklist) {
    parts.push('', '## 完成标准', ...phase.checklist.map((item) => `- [ ] ${item}`))
  }
  return parts.join('\n')
}

export function routeMarkdown() {
  const rows = [
    '| 阶段 | 内容 | 难度 | 用时 | 配套实验 |',
    '| --- | --- | --- | --- | --- |',
    ...CURRICULUM.map((phase) =>
      `| \`${phase.id}\` | ${phase.title.replace(/^第 \d+ 阶段：/, '')} | ${phase.level} | ${phase.days} | ${phase.lab ? `\`${phase.lab}\`` : '-'} |`),
  ]
  return [
    '# HCIA-Datacom 实验学习路线',
    '由易到难，共 10 个阶段，预计 6-8 周（每天 2 小时）。',
    '',
    ...rows,
    '',
    '**使用方式**：',
    '1. `netlab_curriculum action=progress` 看当前进度',
    '2. `netlab_curriculum action=next` 拿下一阶段',
    '3. `netlab_curriculum action=phase phase=phase-2` 看详细任务',
    '4. 每阶段结束用 `netlab_quiz` 自测。',
  ].join('\n')
}
