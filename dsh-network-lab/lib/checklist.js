/**
 * Change checklists: what a senior engineer runs before, during and after
 * touching a device. They are deliberately numbers-first and command-first so
 * a trainee can tick them without judgement calls.
 */

export const CHECKLISTS = {
  'before-change': {
    title: '变更前检查（上设备前必过）',
    goal: '确认这台设备、这个时间、这次改动是可以回退的',
    items: [
      { id: 'b1', text: '确认设备型号、sysname、所在站点与变更单一致', command: 'display version', critical: true },
      { id: 'b2', text: '导出当前配置作为回滚点', command: 'display current-configuration', critical: true },
      { id: 'b3', text: '确认已保存配置与运行配置一致（无未保存修改）', command: 'display saved-configuration | include sysname', critical: true },
      { id: 'b4', text: '确认接口状态，记录变更前 UP/DOWN 情况', command: 'display interface brief' },
      { id: 'b5', text: '记录变更前的路由/邻居基线', command: 'display ip routing-table', critical: false },
      { id: 'b6', text: '确认远程登录不会把地址踩掉（VTY 保留、不改管理口 IP）', command: 'display user-interface', critical: true },
      { id: 'b7', text: '确认变更窗口内没人并行操作同一设备', command: 'display users' },
    ],
    guard: [
      '禁止在业务高峰期执行 reload/undo stp/清空配置类操作',
      '远程变更前必须先确认 console 有人值守，否则改错就再也连不回来',
      '没有回滚点不动手：先留一份 display current-configuration 到本地',
    ],
  },
  'during-change': {
    title: '变更中检查（每敲完一块就验一块）',
    goal: '一次只改一个逻辑块，改完立刻验证，绝不连续敲十条再回头看',
    items: [
      { id: 'd1', text: '每改完一个接口，立即回看该接口配置', command: 'display current-configuration interface GigabitEthernet0/0/1' },
      { id: 'd2', text: '配置后确认接口未被 shutdown', command: 'display interface brief', critical: true },
      { id: 'd3', text: '确认 VLAN/trunk 放行列表符合规划', command: 'display port vlan active' },
      { id: 'd4', text: '确认路由表出现了预期路由，且没有意外消失的路由', command: 'display ip routing-table', critical: true },
      { id: 'd5', text: '确认 OSPF 邻居仍为 Full（如涉及动态路由）', command: 'display ospf peer brief' },
      { id: 'd6', text: '数据面抽测：从源到目的 ping 一次', command: 'ping -c 4 <目标地址>' },
    ],
    guard: [
      '不要用 reload 验证配置，那是最后一次手段',
      '改 trunk 时先确认远端放行，否则先断全公司',
      '改安全策略/ACL 前想清楚双向：只拦一个方向可能被回程放通或全被拒',
    ],
  },
  'after-change': {
    title: '变更后检查（收尾与交接）',
    goal: '让配置真正落盘、可被下一个人接手，并能随时回滚',
    items: [
      { id: 'a1', text: 'review 完整运行配置再保存', command: 'display current-configuration', critical: true },
      { id: 'a2', text: '保存配置（用户视图下）', command: 'save', critical: true },
      { id: 'a3', text: '确认 saved 配置已经包含本次改动', command: 'display saved-configuration', critical: true },
      { id: 'a4', text: '验证业务：关键路径 ping/tracert 通过', command: 'ping -c 4 <关键目标>' },
      { id: 'a5', text: '记录变更内容、时间、操作人、回滚命令到变更单', command: '-', critical: true },
      { id: 'a6', text: '清理临时调试配置（临时 ACL、测试路由、临时 sysname）', command: 'display current-configuration', critical: true },
      { id: 'a7', text: '如配置了 description，确认对端也能对上', command: 'display interface description' },
    ],
    guard: [
      '没 save = 没做完，eNSP 重启和真机掉电都会全丢',
      '回滚命令必须提前写出来放在变更单里，事故现场现想来不及',
      '交接时把"哪条命令改了哪个表"讲清楚，比贴全量配置有用',
    ],
  },
  'troubleshoot': {
    title: '排障检查卡（分层，不跳层）',
    goal: '用最少命令、最短时间证明故障在哪一层',
    items: [
      { id: 't1', text: '现象复述：谁 ping 谁、哪条命令报错、什么时候开始的', command: '-', critical: true },
      { id: 't2', text: '物理/接口层', command: 'display interface brief' },
      { id: 't3', text: '链路聚合/光模块（如涉及）', command: 'display eth-trunk / display transceiver diagnosis' },
      { id: 't4', text: '二层 VLAN/trunk', command: 'display vlan / display port vlan active' },
      { id: 't5', text: 'MAC 学习位置', command: 'display mac-address' },
      { id: 't6', text: '三层 ARP/接口', command: 'display arp / display ip interface brief' },
      { id: 't7', text: '路由表', command: 'display ip routing-table' },
      { id: 't8', text: '动态路由邻居', command: 'display ospf peer brief' },
      { id: 't9', text: '策略 ACL/NAT/安全策略', command: 'display acl / display nat session all' },
      { id: 't10', text: '确定根因后，只做最小改动修复，再跑一遍验证', command: '-', critical: true },
    ],
    guard: [
      '不改配置先证明问题在哪层，避免边猜边改越改越乱',
      '不要 reset/reboot 作为排障手段，除非确认可以接受业务中断',
      '一次只改一个变量，改完立刻验，否则回滚时分不清是谁修好的',
    ],
  },
}

export function listChecklists() {
  return Object.entries(CHECKLISTS).map(([id, check]) => ({
    id,
    title: check.title,
    goal: check.goal,
    count: check.items.length,
  }))
}

export function findChecklist(id) {
  const key = String(id || '').trim().toLowerCase()
  return CHECKLISTS[key] || null
}

export function checklistMarkdown(id) {
  const check = findChecklist(id)
  if (!check) throw new Error(`找不到检查卡 ${id}`)
  const parts = [
    `# ${check.title}`,
    `**目标**：${check.goal}`,
    '',
    '| # | 检查项 | 命令 | 级别 |',
    '| --- | --- | --- | --- |',
    ...check.items.map((item, index) =>
      `| ${index + 1} | ${item.text.replace(/\|/g, '\\|')} | \`${item.command.replace(/\|/g, '\\|')}\` | ${item.critical ? '必做' : '建议'} |`),
    '',
    '## 红线',
    ...check.guard.map((item) => `- ${item}`),
  ]
  return parts.join('\n')
}

/** Compose a checklist tailored to a lab's verification points. */
export function checklistForLab(lab) {
  if (!lab) return null
  const parts = [
    `# ${lab.title}：变更检查卡`,
    `**设备要求**：${lab.devices || '见实验说明'}`,
    '',
    '## 变更前',
    '```text',
    'display version',
    'display current-configuration',
    'display interface brief',
    '```',
    '',
    '## 变更中（按实验验证点逐项）',
    '```text',
    ...lab.verify.map((check) => `${check.role}: ${check.command}`),
    '```',
    '',
    '## 变更后',
    '```text',
    'return',
    'save',
    'display saved-configuration',
    '```',
    '',
    '## 常见坑',
    ...lab.pitfalls.map((item) => `- ${item}`),
  ]
  return parts.join('\n')
}

export function checklistIndexMarkdown() {
  const rows = [
    '| id | 检查卡 | 项数 |',
    '| --- | --- | --- |',
    ...listChecklists().map((item) => `| \`${item.id}\` | ${item.title} | ${item.count} |`),
  ]
  return [
    '# 检查卡',
    '',
    ...rows,
    '',
    '用法：`netlab_checklist id=before-change`，或 `netlab_checklist lab=vlan-basic` 按实验生成。',
  ].join('\n')
}
