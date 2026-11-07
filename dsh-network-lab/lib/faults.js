/**
 * 故障排查案例库。
 * 每个案例：症状 → 分层定位 → 注入命令（可选）→ 排查步骤 → 根因 → 修复 → 复盘问题。
 * 注入命令默认不执行，需要用户明确同意后传 inject=true。
 */

export const FAULTS = [
  {
    id: 'f01-vlan-mismatch',
    title: '同 VLAN 跨交换机不通：trunk 没放行',
    level: '初级',
    layer: '二层',
    symptom: 'PC1(192.168.10.10) 和 PC3(192.168.10.30) 同属 VLAN 10，接在两台交换机，ping 不通；两台交换机之间能 ping 通管理地址。',
    topology: 'PC1 --- G0/0/1 [SW1] G0/0/24 ===== G0/0/24 [SW2] G0/0/1 --- PC3',
    rootCause: 'SW1 或 SW2 的 trunk 接口没有 allow-pass vlan 10，带 VLAN 10 标签的帧在 trunk 上被丢弃。',
    inject: [
      { role: 'SW1', commands: ['system-view', 'interface GigabitEthernet0/0/24', 'undo port trunk allow-pass vlan 10', 'quit'] },
    ],
    steps: [
      { layer: '物理', command: 'display interface brief', expect: 'GigabitEthernet0/0/24 的 Physical 和 Protocol 都是 UP' },
      { layer: '二层', command: 'display vlan', expect: '两台都有 VLAN 10，且 G0/0/1 在 VLAN 10 中' },
      { layer: '二层', command: 'display port vlan active', expect: 'G0/0/24 的 trunk 允许列表里没有 10' },
    ],
    fix: [
      { role: 'SW1', commands: ['system-view', 'interface GigabitEthernet0/0/24', 'port trunk allow-pass vlan 10', 'quit'] },
    ],
    review: ['为什么管理地址能通，业务 VLAN 却不通？', '如果改成 hybrid 接口，需要哪条命令？'],
  },
  {
    id: 'f02-access-pvid',
    title: 'PC 接口划错 VLAN：PVID 不对',
    level: '初级',
    layer: '二层',
    symptom: 'PC1 配的是 192.168.20.10 却 ping 不通同网段 PC2，PC1 反而能 ping 通 VLAN 20 的另一台机器。',
    topology: 'PC1 --- G0/0/1 [SW1]，VLAN 20 网段 192.168.20.0/24',
    rootCause: 'G0/0/1 的 access 接口 PVID 仍是默认 VLAN 1 或错误的 VLAN 10，PC1 的帧被打上错误标签。',
    inject: [
      { role: 'SW1', commands: ['system-view', 'interface GigabitEthernet0/0/1', 'port default vlan 10', 'quit'] },
    ],
    steps: [
      { layer: '二层', command: 'display port vlan active', expect: 'G0/0/1 的 PVID 是 10，不是 20' },
      { layer: '二层', command: 'display mac-address', expect: 'PC1 的 MAC 学在 VLAN 10 下' },
    ],
    fix: [
      { role: 'SW1', commands: ['system-view', 'interface GigabitEthernet0/0/1', 'port default vlan 20', 'quit'] },
    ],
    review: ['PVID 在发送和接收方向分别起什么作用？', '如果 PC 自身 IP 配错，会看到什么现象？'],
  },
  {
    id: 'f03-gateway-missing',
    title: '缺省路由缺失：内网上不了外网',
    level: '中级',
    layer: '三层',
    symptom: '内网 PC 能访问网关，能 ping 通 R1 的内网口，但 ping 不通 ISP 地址，NAT 会话为 0。',
    topology: 'PC --- G0/0/0 [R1] G0/0/1 --- ISP(200.1.1.2)',
    rootCause: 'R1 缺少指向 ISP 的缺省路由，或者 NAT 未配置/未命中。',
    inject: [
      { role: 'R1', commands: ['system-view', 'undo ip route-static 0.0.0.0 0 200.1.1.2', 'quit'] },
    ],
    steps: [
      { layer: '三层', command: 'display ip routing-table', expect: '没有 0.0.0.0/0 或下一跳错误' },
      { layer: '策略', command: 'display current-configuration | include nat', expect: '出口接口应有 nat outbound' },
      { layer: '策略', command: 'display nat session all', expect: '为空说明流量没到 NAT 或路由不通' },
    ],
    fix: [
      { role: 'R1', commands: ['system-view', 'ip route-static 0.0.0.0 0 200.1.1.2'] },
    ],
    review: ['NAT 会话为空可能的两类原因？', '如果 ISP 侧回程路由缺失，内网会看到什么现象？'],
  },
  {
    id: 'f04-ospf-area',
    title: 'OSPF 邻居卡在 Init：区域号不一致',
    level: '中级',
    layer: '三层/动态路由',
    symptom: 'R1 和 R2 互联接口互通，但 display ospf peer 一直显示 Init 或没有邻居。',
    topology: '[R1] G0/0/0 --- G0/0/0 [R2]',
    rootCause: '两台路由器宣告同一网段时所在的 OSPF 区域不一致，或者 Hello/Dead 定时器不同。',
    inject: [
      { role: 'R2', commands: ['system-view', 'ospf 1', 'undo area 0', 'area 1', 'network 10.1.1.0 0.0.0.255', 'quit', 'quit'] },
    ],
    steps: [
      { layer: '三层', command: 'display ip interface brief', expect: '互联接口 UP 且同网段' },
      { layer: '动态路由', command: 'display ospf peer', expect: '状态停留在 Init/2-Way，或邻居不存在' },
      { layer: '动态路由', command: 'display ospf interface', expect: '两侧 Area 号不一致或 Hello 定时器不同' },
    ],
    fix: [
      { role: 'R2', commands: ['system-view', 'ospf 1', 'undo area 1', 'area 0', 'network 10.1.1.0 0.0.0.255', 'quit', 'quit'] },
    ],
    review: ['Init 和 2-Way 分别代表什么？', '还有哪些原因会让邻居起不来？'],
  },
  {
    id: 'f05-acl-direction',
    title: 'ACL 方向配反：本该只拦一个却全被拒',
    level: '中级',
    layer: '策略',
    symptom: '配了 ACL 禁止 PC1 访问服务器 80 端口，结果所有 PC 都访问不了服务器，其他业务也受影响。',
    topology: 'PC1/PC2 --- G0/0/0 [R1] G0/0/1 --- Server',
    rootCause: 'ACL 应用接口或方向错误（或缺少 permit 规则），导致全部流量命中默认拒绝。',
    inject: [
      { role: 'R1', commands: ['system-view', 'interface GigabitEthernet0/0/1', 'traffic-filter inbound acl 3000', 'quit'] },
    ],
    steps: [
      { layer: '策略', command: 'display acl 3000', expect: '规则顺序和反掩码是否正确' },
      { layer: '策略', command: 'display traffic-filter applied-record', expect: '应用在哪个接口、哪个方向' },
      { layer: '数据面', command: 'display interface GigabitEthernet0/0/0', expect: '是否有大量 INPUT DROP 增长' },
    ],
    fix: [
      { role: 'R1', commands: ['system-view', 'interface GigabitEthernet0/0/1', 'undo traffic-filter inbound acl 3000', 'quit'] },
    ],
    review: ['为什么建议"靠近源"应用安全策略？', 'ACL 末尾的默认规则是什么？'],
  },
  {
    id: 'f06-stp-loop',
    title: 'STP 被关闭导致广播风暴',
    level: '高级',
    layer: '二层',
    symptom: '三角拓扑交换机 CPU 飙高、指示灯狂闪、全网变慢甚至断网。',
    topology: 'SW1 / SW2 / SW3 三角互联',
    rootCause: '某台交换机 stp 被 undo 或未启用，形成二层环路产生广播风暴。',
    inject: [
      { role: 'SW3', commands: ['system-view', 'undo stp enable', 'quit'] },
    ],
    steps: [
      { layer: '二层', command: 'display stp brief', expect: '某台设备没有 STP 或所有端口都是 Forwarding' },
      { layer: '二层', command: 'display cpu-usage', expect: 'CPU 异常高' },
    ],
    fix: [
      { role: 'SW3', commands: ['system-view', 'stp enable'] },
    ],
    review: ['为什么三角拓扑必须开 STP？', 'STP 收敛期间可能短暂环路，怎么缓解？'],
  },
  {
    id: 'f07-dhcp-pool',
    title: 'DHCP 客户端拿不到地址',
    level: '初级',
    layer: '应用/DHCP',
    symptom: 'PC 显示 APIPA 169.254.x.x，或者一直 DHCP 中。',
    topology: 'PC --- G0/0/0 [R1]',
    rootCause: '地址池网段和接口网段不一致，或接口没配置 dhcp select global。',
    inject: [
      { role: 'R1', commands: ['system-view', 'interface GigabitEthernet0/0/0', 'undo dhcp select global', 'quit'] },
    ],
    steps: [
      { layer: '三层', command: 'display ip interface brief', expect: '接口有地址且和地址池网段一致' },
      { layer: 'DHCP', command: 'display ip pool', expect: '地址池存在、可用地址不为 0' },
      { layer: 'DHCP', command: 'display current-configuration | include dhcp', expect: '全局 dhcp enable 与 dhcp select 都有' },
    ],
    fix: [
      { role: 'R1', commands: ['system-view', 'interface GigabitEthernet0/0/0', 'dhcp select global', 'quit'] },
    ],
    review: ['169.254 地址意味着什么？', '接口地址池和全局地址池怎么选？'],
  },
  {
    id: 'f08-trunk-native',
    title: '跨厂商 trunk native VLAN 不一致',
    level: '高级',
    layer: '二层',
    symptom: '华为设备之间正常，接入另一品牌交换机后 VLAN 1 管理流量异常，某些 VLAN 不通。',
    topology: '[SW-Huawei] trunk === trunk [SW-Other]',
    rootCause: '两侧 trunk 的 native VLAN（PVID）不一致，无标签帧被归入不同 VLAN。',
    inject: [
      { role: 'SW1', commands: ['system-view', 'interface GigabitEthernet0/0/24', 'port trunk pvid vlan 99', 'quit'] },
    ],
    steps: [
      { layer: '二层', command: 'display port vlan active', expect: '两侧 trunk 的 PVID 是否一致' },
      { layer: '二层', command: 'display vlan', expect: 'native VLAN 是否被正确放行' },
    ],
    fix: [
      { role: 'SW1', commands: ['system-view', 'interface GigabitEthernet0/0/24', 'undo port trunk pvid vlan', 'quit'] },
    ],
    review: ['trunk 默认 VLAN 的作用？', '跨厂商互联前应该先对齐哪些参数？'],
  },
  {
    id: 'f09-aaa-lockout',
    title: 'AAA 配错把 VTY 锁死，远程登录全断',
    level: '中级',
    layer: '管理面',
    symptom: '配置 AAA 之后 telnet 连不上了，但 console 还能进。display current-configuration 里有 local-user，也有 authentication-mode。',
    topology: 'Admin PC --- [AR1] VTY 0 4',
    rootCause: 'local-user 的 service-type 没包含 telnet（或只写了 ssh），或者 VTY 的 authentication-mode 不是 aaa，导致认证请求被拒绝。',
    inject: [
      { role: 'AR1', commands: ['system-view', 'aaa', 'local-user admin service-type ssh', 'quit'] },
    ],
    steps: [
      { layer: '管理面', command: 'display current-configuration | include local-user', expect: '检查 service-type 是否包含 telnet' },
      { layer: '管理面', command: 'display current-configuration | include authentication-mode', expect: 'VTY 必须是 authentication-mode aaa' },
      { layer: '管理面', command: 'display telnet server status', expect: 'Telnet 服务是否开启' },
      { layer: '管理面', command: 'display tcp status', expect: '23 端口是否有监听' },
    ],
    fix: [
      { role: 'AR1', commands: ['system-view', 'aaa', 'local-user admin service-type telnet ssh', 'quit'] },
    ],
    review: [
      '为什么生产环境改 AAA 前必须先确认 console 有人在？',
      'service-type 和 privilege level 分别管什么？',
    ],
    ask: [
      '"连不上"是 PC 侧 telnet 超时，还是提示认证失败？两者排查方向完全不同。',
      '最近改的是本地用户还是 VTY？两个地方任一配错都会锁死。',
    ],
  },
  {
    id: 'f10-save-lost',
    title: '改完没保存，重启后配置全丢',
    level: '初级',
    layer: '配置管理',
    symptom: '昨天配好的 VLAN 和路由，今天设备重启后全部消失，display vlan 只剩默认 VLAN 1。',
    topology: '单台 S5700',
    rootCause: '修改后没有执行 save；内存中的 running-config 随重启丢失，flash 里的 saved-configuration 还是旧版本。',
    inject: [
      { role: 'SW1', commands: ['system-view', 'undo vlan batch 10 20', 'quit'] },
    ],
    steps: [
      { layer: '配置管理', command: 'display current-configuration | include vlan', expect: '当前配置里已没有业务 VLAN' },
      { layer: '配置管理', command: 'display saved-configuration | include vlan', expect: 'saved 配置可能也是旧的，或根本没有业务 VLAN' },
      { layer: '配置管理', command: 'display startup', expect: '确认下一次启动用的是哪个配置文件' },
    ],
    fix: [
      { role: 'SW1', commands: ['system-view', 'vlan batch 10 20', 'quit', 'return', 'save'] },
    ],
    review: [
      'running-config 和 saved-configuration 分别存在哪里？',
      '重启前最少要执行哪两条命令确认配置已落盘？',
    ],
    ask: [
      '是设备重启丢的，还是有人 reset saved-configuration？先看启动时间和最后修改时间。',
      '丢失的是全部配置还是最近一段变更？这决定是没 save 还是被回滚。',
    ],
  },
  {
    id: 'f11-vlanif-shutdown',
    title: 'VLANIF 配对了但接口是 shutdown',
    level: '中级',
    layer: '三层',
    symptom: '交换机上给 VLANIF 配了网关地址，PC 也配了正确 IP 和网关，但 ping 不通网关。display ip interface brief 里 VLANIF 的 Physical 是 DOWN 或 Protocol 是 DOWN。',
    topology: 'PC --- access 口 [SW1] VLANIF 10 = 192.168.10.1/24',
    rootCause: 'VLANIF 接口被 shutdown，或者 VLAN 内没有任何 UP 的成员端口（物理状态跟着 DOWN）。',
    inject: [
      { role: 'SW1', commands: ['system-view', 'interface Vlanif10', 'shutdown', 'quit'] },
    ],
    steps: [
      { layer: '三层', command: 'display ip interface brief', expect: 'Vlanif10 的 Protocol 应为 UP，而不是 DOWN' },
      { layer: '三层', command: 'display interface Vlanif10', expect: 'VLANIF 当前状态和是否 shutdown' },
      { layer: '二层', command: 'display vlan 10', expect: 'VLAN 10 里至少有一个 UP 的成员口' },
      { layer: '物理', command: 'display interface brief', expect: '接 PC 的物理口必须 UP' },
    ],
    fix: [
      { role: 'SW1', commands: ['system-view', 'interface Vlanif10', 'undo shutdown', 'quit'] },
    ],
    review: [
      'VLANIF 的 UP 条件是什么？为什么 VLAN 没成员口它就 DOWN？',
      'PC 能 ping 通网关但 ping 不通其他 VLAN，应该往哪里查？',
    ],
    ask: [
      '"ping 不通网关"具体是 Request time out 还是 Destination host unreachable？',
      '同 VLAN 内 PC 之间能通吗？能通说明二层没问题，只看 VLANIF。',
    ],
  },
  {
    id: 'f12-compound-nat',
    title: '复合故障：NAT 没命中 + ACL 顺序错',
    level: '高级',
    layer: '策略',
    symptom: '内网能 ping 通出口地址，也能访问部分外网，但访问某个特定服务器 200.1.1.20:443 始终超时；display nat session all 里有别的流量会话，唯独没有去 200.1.1.20 的。',
    topology: 'PC(192.168.1.0/24) --- G0/0/0 [R1] G0/0/1(200.1.1.1) --- ISP --- Server(200.1.1.20)',
    rootCause: '两个原因叠加：ACL 3000 的 deny 规则写在 permit 之前且匹配范围过大，把去 200.1.1.20 的流量一起拦了；同时该服务器网段不在 NAT ACL 2000 的匹配范围里，即使 ACL 放行也不会转换。',
    inject: [
      { role: 'R1', commands: ['system-view', 'acl 3000', 'rule 5 deny ip source 192.168.1.0 0.0.0.255 destination 200.1.1.0 0.0.0.255', 'quit'] },
    ],
    steps: [
      { layer: '三层', command: 'display ip routing-table', expect: '到 200.1.1.0/24 有直连路由且接口 UP' },
      { layer: '策略', command: 'display acl 3000', expect: '找 deny 规则的匹配范围和顺序' },
      { layer: '策略', command: 'display traffic-filter applied-record', expect: '确认 ACL 应用的接口和方向' },
      { layer: '策略', command: 'display acl 2000', expect: 'NAT 用的 ACL 是否覆盖 192.168.1.0/24 全段' },
      { layer: '数据面', command: 'display nat session all', expect: '有没有去 200.1.1.20 的会话' },
    ],
    fix: [
      { role: 'R1', commands: ['system-view', 'acl 3000', 'undo rule 5', 'rule 5 deny tcp source 192.168.1.10 0 destination 200.1.1.20 0 destination-port eq 443', 'rule 10 permit ip', 'quit'] },
    ],
    review: [
      '为什么"部分外网能通、部分不通"最容易被判成 ISP 问题？',
      'ACL 匹配是先命中先执行，为什么 deny 放在 permit 前面风险大？',
      'NAT 不命中时，display nat session 里能看到什么？',
    ],
    ask: [
      '"访问不了"是所有目标都不通，还是只有某个 IP/端口？范围不同，先查的层完全不同。',
      '有没有用 tracert 确认流量到哪一跳就断了？',
      'NAT 会话里有没有对应条目？没有说明流量根本没到 NAT 转换点。',
    ],
  },
]

/** 新人提问引导：先问对问题，再排障。 */
export const DIAGNOSIS_QUESTIONS = [
  { id: 'q1', question: '现象是什么层级的？', hint: 'ping 不通 ≠ 业务不通；同一目标不同端口结果可能不同。' },
  { id: 'q2', question: '范围有多大？', hint: '一台 PC / 一个 VLAN / 一个站点 / 全部，范围决定先查哪层。' },
  { id: 'q3', question: '什么时候开始的？', hint: '跟某次变更对齐，比盲查快十倍。' },
  { id: 'q4', question: '最近改了什么？', hint: '不知道就查 display current 和 saved 的差异。' },
  { id: 'q5', question: '原来是通的吗？', hint: '原来通现在不通是变更问题；从来没通过是配置/设计问题。' },
  { id: 'q6', question: '什么流量能通、什么不能通？', hint: '能通的部分给你的信息比不能通的更多。' },
]

export function diagnosisMarkdown() {
  const rows = [
    '| # | 先问什么 | 为什么 |',
    '| --- | --- | --- |',
    ...DIAGNOSIS_QUESTIONS.map((item, index) => `| ${index + 1} | ${item.question} | ${item.hint} |`),
  ]
  return [
    '# 排障前先问对 6 个问题',
    '',
    ...rows,
    '',
    '> 很多新人一上来就 `display vlan`，但真正的效率来自先缩小范围。',
  ].join('\n')
}

export function listFaults({ level, layer } = {}) {
  return FAULTS.filter((fault) => {
    if (level && fault.level !== level) return false
    if (layer && !fault.layer.includes(layer)) return false
    return true
  })
}

export function findFault(id) {
  const key = String(id || '').trim().toLowerCase()
  return FAULTS.find((fault) => fault.id === key) || null
}

export function faultMarkdown(fault, { teaching = true } = {}) {
  const parts = [
    `# 故障案例：${fault.title}`,
    `**难度**：${fault.level}　**层级**：${fault.layer}`,
    '',
    '## 症状',
    fault.symptom,
    '',
    '## 拓扑',
    '```text',
    fault.topology,
    '```',
    ...(Array.isArray(fault.ask) && fault.ask.length
      ? ['', '## 先问对问题', '不要一上来就敲命令，先确认这几件事：', ...fault.ask.map((item) => `- ${item}`)]
      : []),
    '',
    '## 分层排查',
    '```text',
    ...fault.steps.map((step) => `${step.layer.padEnd(8)} ${step.command}`),
    '```',
    '看到这些现象应该说明什么：',
    ...fault.steps.map((step) => `- **${step.layer}**：${step.expect}`),
  ]
  if (!teaching) {
    parts.push(
      '',
      '## 根因',
      fault.rootCause,
      '',
      '## 修复',
      ...fault.fix.map((block) => `### ${block.role}\n\`\`\`text\n${block.commands.join('\n')}\n\`\`\``),
      '',
      '## 复盘问题',
      ...fault.review.map((item) => `- ${item}`),
    )
  } else {
    parts.push(
      '',
      '## 学习模式',
      '先不要直接看答案：请按上面的分层排查顺序，每次只执行一条命令，根据输出判断下一步。',
      '自己找到根因后，再说"看答案"（`inject=false, teaching=false` 或 `action=answer`）。',
    )
  }
  return parts.join('\n')
}

export function faultIndexMarkdown(faults = FAULTS) {
  const rows = [
    '| id | 故障 | 层级 | 难度 |',
    '| --- | --- | --- | --- |',
    ...faults.map((fault) => `| \`${fault.id}\` | ${fault.title} | ${fault.layer} | ${fault.level} |`),
  ]
  return ['# 故障案例库', '', ...rows, '', '用 `netlab_fault action=show id=f01-vlan-mismatch` 开始一个案例。'].join('\n')
}
