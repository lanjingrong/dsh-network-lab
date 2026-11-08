/**
 * eNSP / 华为现场踩坑知识库。
 * 每个坑：现象关键词（match，VRP 原始报错）→ 人话描述（symptom）→ 原因 → 怎么查 → 怎么修。
 * netlab_exec 失败时会用这里的规则自动匹配，把“你可能踩了这些坑”附在结果后面。
 * symptom 是给学习者用的：他们描述现象时说的是“ping 不通”“两边网段不一样”，
 * 不是“Unrecognized command found at "^" position”。
 */

export const PITFALLS = [
  {
    id: 'p01-ar-slow-boot',
    category: '环境',
    title: 'AR 路由器启动慢，别以为坏了',
    match: [/登录超时/i, /未识别到.*提示符/i, /等待设备输出超时/i],
    symptom: [/启动慢/i, /开机慢/i, /开不起来/i, /一直没反应/i, /等很久/i, /转圈/i, /加载中/i],
    hint: 'AR2220 启动要 1-2 分钟，USG6000V 更慢。',
    check: ['在 eNSP 控制台看是否还在刷启动日志', '等 30-60 秒后用 newSession=true 重连'],
    fix: ['netlab_exec device=<id> commands=["display version"] newSession=true'],
  },
  {
    id: 'p02-port-busy',
    category: '环境',
    title: '串口被别的客户端占用',
    match: [/ECONNREFUSED/i, /ECONNRESET/i, /连接被重置/i, /Connection refused/i, /连接已关闭/i],
    symptom: [/连不上/i, /连接失败/i, /被占用/i, /端口被占/i, /连不进去/i, /en?sp.*连/i, /扫描.*没/i],
    hint: 'eNSP 一个串口同时只允许一个客户端。',
    check: ['关闭 eNSP 里双击设备打开的控制台窗口', '关闭 SecureCRT / PuTTY / Xshell'],
    fix: ['netlab_devices action=disconnect id=<id>', '再 netlab_exec ... newSession=true'],
  },
  {
    id: 'p03-view-mismatch',
    category: '命令',
    title: '提示符不对就是视图不对',
    match: [/Unrecognized command found at "\^" position/i, /Error:\s*Unrecognized command/i],
    symptom: [/视图不对/i, /模式不对/i, /输入.*没反应/i, /在用户视图/i, /在系统视图/i, /尖括号/i, /方括号/],
    hint: '在用户视图 <HOST> 敲了接口命令，或在接口视图敲了系统视图命令。',
    check: ['看当前提示符是 < > 还是 [ ]', 'display current-configuration 看上下文'],
    fix: ['system-view', '或 return 回用户视图'],
  },
  {
    id: 'p04-interface-missing',
    category: '命令',
    title: '接口不存在，先确认设备型号',
    match: [/Wrong parameter found at "\^" position/i, /Interface.*does not exist/i, /The interface does not exist/i],
    symptom: [/接口不存在/i, /没有这个接口/i, /型号.*不/i, /接口名/i, /g0\/(0|1)\/\d+.*错/i],
    hint: 'G0/0/24 是交换机写法；路由器可能是 G0/0/0。拖错设备型号，命令全白写。',
    check: ['display version / display device 看型号', 'display interface brief 列出真实接口名'],
    fix: ['按 display interface brief 的真实接口名改命令'],
  },
  {
    id: 'p05-save-view',
    category: '配置管理',
    title: 'save 要在用户视图下',
    match: [/Save the configuration failed/i, /save.*fail/i, /The configuration is already saved/i],
    symptom: [/保存失败/i, /save.*失败/i, /存不下来/i],
    hint: '在 [HOST] 或接口视图敲 save 会失败。',
    check: ['看提示符是否还是 [ ]'],
    fix: ['return', '然后 save，再输入 y'],
  },
  {
    id: 'p06-save-confirm',
    category: '配置管理',
    title: 'save 有 [Y/N] 确认',
    match: [/Are you sure to continue/i, /\[Y\/N\]/i],
    symptom: [/要不要.*y/i, /确认.*保存/i, /卡在.*确认/i, /怎么回/i],
    hint: '不输入 y 不算保存。',
    check: ['netlab_exec 传 save=true 时插件会自动处理确认'],
    fix: ['手动在 eNSP 控制台输入 y'],
  },
  {
    id: 'p07-not-saved',
    category: '配置管理',
    title: '改完不保存 = 白干',
    match: [/重启.*配置.*丢/i, /配置.*消失/i, /sysname.*Huawei/i],
    symptom: [/重启后.*没/i, /重启.*就没了/i, /配置没了/i, /配置丢了/i, /变回默认/i, /白配/i],
    hint: 'eNSP 设备重启等同真机重启，没保存的配置全丢。',
    check: ['display current-configuration 对比 display saved-configuration'],
    fix: ['return', 'save', 'display saved-configuration 确认'],
  },
  {
    id: 'p08-wildcard-mask',
    category: '命令',
    title: '反掩码写成正掩码',
    match: [/Wrong parameter.*OPSF|OSPF.*Wrong parameter/i, /network.*Error/i],
    symptom: [/反掩码/i, /通配符/i, /掩码写成/i, /network.*报错/i, /0\.0\.0\.255/i, /255\.255\.255\.0.*错/i],
    hint: 'OSPF/ACL 的 network 用反掩码：0.0.0.255 对，255.255.255.0 错。',
    check: ['display ospf interface 看宣告的网段是否正确'],
    fix: ['network 10.1.1.0 0.0.0.255'],
  },
  {
    id: 'p09-trunk-allow',
    category: '二层',
    title: 'trunk 默认只放行 VLAN 1',
    match: [/VLAN\s+\d+\s+does not exist/i, /VLAN.*not exist/i],
    symptom: [/两边.*pvid.*(不|不同|不一致)/i, /pvid.*不一致/i, /pvid.*不一样/i, /pvid.*不同/i, /pvid.*不对/i, /trunk.*不通/i, /trunk.*没放行/i, /vlan.*没放行/i, /同\s*vlan.*不通/i, /跨交换机.*不通/i, /allow-pass/i],
    hint: 'trunk 默认只放行 VLAN 1，配 trunk 放行前 VLAN 必须先创建。',
    check: ['display vlan 看 VLAN 是否存在', 'display port vlan active 看 allow-pass 列表'],
    fix: ['vlan batch 10 20', 'interface G0/0/24', 'port trunk allow-pass vlan 10 20'],
  },
  {
    id: 'p10-acl-implicit-deny',
    category: '策略',
    title: 'ACL 末尾有隐含的拒绝所有',
    match: [/traffic-filter.*fail/i, /ACL.*not exist/i],
    symptom: [/acl.*全拦/i, /全被拦/i, /不让访问/i, /网页打不开/i, /网站.*打不开/i, /访问控制/i, /加了acl.*不通/i],
    hint: '只写 deny 不写 permit，会把所有流量都拦掉（ACL 末尾隐含 deny）。',
    check: ['display acl <编号> 看规则顺序', 'display traffic-filter applied-record 看应用方向'],
    fix: ['acl 3000', 'rule 10 permit ip'],
  },
  {
    id: 'p11-aaa-lockout',
    category: '管理面',
    title: 'AAA 配错把 VTY 锁死',
    match: [/Username:/i, /Password:/i, /Authentication fail/i, /authentication.*fail/i],
    symptom: [/登录不上/i, /密码不对/i, /认证失败/i, /远程登录/i, /telnet.*失败/i, /ssh.*失败/i, /锁死/i],
    hint: 'local-user 的 service-type 没含 telnet，或 VTY 认证方式不是 aaa。',
    check: ['display current-configuration | include local-user', 'display current-configuration | include authentication-mode'],
    fix: ['aaa', 'local-user admin service-type telnet ssh', 'quit'],
  },
  {
    id: 'p12-vlanif-down',
    category: '三层',
    title: 'VLANIF 配对了但接口 shutdown',
    match: [/Vlanif.*DOWN/i, /VLANIF.*down/i],
    symptom: [/vlanif.*down/i, /vlanif.*起不来/i, /三层.*不通/i, /vlan间.*不通/i, /vlanif.*shutdown/i],
    hint: 'VLANIF 的 Protocol 要 UP，VLAN 内至少有一个 UP 成员口，接口不能 shutdown。',
    check: ['display ip interface brief 看 Vlanif 是否 DOWN', 'display vlan <id> 看成员口'],
    fix: ['interface Vlanif10', 'undo shutdown'],
  },
  {
    id: 'p13-no-return-route',
    category: '三层',
    title: 'ping 不通先看是不是没回程',
    match: [/Request time out/i, /Destination host unreachable/i, /100\.0% packet loss/i],
    symptom: [/网段.*不对/i, /网段.*不一样/i, /网段.*不同/i, /ip.*不在.*网段/i, /地址.*配错/i, /地址.*不对/i, /ping\s*不通/i, /ping不上/i, /不同[网络段]/i, /回程/i, /单向通/i, /去了回不来/i, /丢包/i, /超时/i, /路由.*不通/i, /通不了/i],
    hint: '单向通、反向不通，十有八九是对端没有回程路由。',
    check: ['两侧都 ping 一次', 'display ip routing-table 看双方路由'],
    fix: ['在对端补静态路由或宣告 OSPF'],
  },
  {
    id: 'p14-ospf-timer',
    category: '路由',
    title: 'OSPF 邻居卡在 Init / 定时器不一致',
    match: [/Init\b.*peer/i, /2-Way/i],
    symptom: [/ospf.*邻居/i, /邻居.*起不来/i, /邻居.*down/i, /卡在\s*(init|2-way)/i, /area.*不一致/i, /区域号/i, /hello/i],
    hint: '区域号、Hello/Dead 定时器、认证任一不一致都会让邻居起不来。',
    check: ['display ospf interface 对比两侧 Area 和 Hello', 'display ospf peer 看状态'],
    fix: ['统一 area 和 hello/dead 定时器'],
  },
  {
    id: 'p15-display-too-long',
    category: '排障',
    title: 'display 输出太长，关键行看不到',
    match: [/More.*----/i, /---- More ----/i],
    symptom: [/输出太长/i, /看不到/i, /翻页/i, /太多了/i, /刷屏/i, /more/i],
    hint: '插件会自动处理分页；手动操作时用 | include 过滤。',
    check: ['display ospf peer | include Full'],
    fix: ['命令后加 | include 关键字'],
  },
  {
    id: 'p16-stp-alte',
    category: '二层',
    title: 'STP 阻塞端口不是故障',
    match: [/ALTE/i, /Blocking/i],
    symptom: [/alte/i, /blocking/i, /阻塞/i, /stp.*端口.*不转/i, /生成树/i, /环路/i],
    hint: 'ALTE 是 STP 防环的正常行为，不是链路故障。',
    check: ['display stp brief 看端口角色'],
    fix: ['不需要修，理解即可'],
  },
  {
    id: 'p17-pc-gateway',
    category: '终端',
    title: 'PC 的网关忘了填',
    match: [/Destination host unreachable/i],
    symptom: [/网关.*没填/i, /网关.*忘了/i, /网关.*不对/i, /pc.*不通/i, /其他网段.*不通/i, /跨网段.*不通/i],
    hint: 'eNSP 里 PC 默认可能没配网关，跨网段必不通。',
    check: ['eNSP 里双击 PC 看 ipconfig', '同网段能否通'],
    fix: ['PC 上配置正确的网关地址'],
  },
  {
    id: 'p18-no-debug-output',
    category: '排障',
    title: 'debugging 没输出/输出刷屏',
    match: [/debugging/i, /terminal monitor/i],
    symptom: [/debug.*没输出/i, /调试.*没/i, /抓包.*没/i, /看不到.*报文/i],
    hint: '需要 terminal monitor + terminal debugging 才能看到调试信息。',
    check: ['display debugging'],
    fix: ['terminal monitor', 'terminal debugging'],
  },
  {
    id: 'p19-vlan1-misuse',
    category: '规范',
    title: 'VLAN 1 承载业务',
    match: [/port default vlan 1\b/i],
    symptom: [/vlan\s*1(?!\d)/i, /默认\s*vlan/i, /(用|当).{0,6}vlan\s*1\b/i],
    hint: 'VLAN 1 是默认 VLAN，生产不要承载业务，也不要当管理 VLAN。',
    check: ['display port vlan active 看 PVID'],
    fix: ['按规划划入业务 VLAN'],
  },
  {
    id: 'p20-reboot-first',
    category: '排障',
    title: '重启是最后的排查手段',
    match: [/Now rebooting/i, /设备正在启动/i],
    symptom: [/重启.*解决/i, /要不要重启/i, /重启一下/i, /重启.*好/i, /reboot.*解决/i, /reboot.*行吗/i, /重启.*能修/i],
    hint: '重启会清掉现场证据，根因还在。',
    check: ['先 display 留证据，再决定要不要重启'],
    fix: ['netlab_exec commands=["display ..."] 收集证据后再重启'],
  },
]

export function listPitfalls({ category } = {}) {
  return PITFALLS.filter((item) => !category || item.category === category || item.category.includes(category))
}

export function findPitfall(id) {
  const key = String(id || '').trim().toLowerCase()
  return PITFALLS.find((item) => item.id === key) || null
}

/**
 * Match pitfalls against device output, an error message, or a learner's own
 * description of a symptom ("trunk 两边 PVID 不一样，断了").
 *
 * `match` patterns are VRP error text and score high; `symptom` patterns are
 * everyday Chinese and score low, so a real error message always outranks a
 * casual phrase that happens to share a word. Returns the highest-scoring
 * matches with a deterministic tie-break.
 */
export function matchPitfalls(text, { limit = 3 } = {}) {
  const source = String(text || '')
  if (!source) return []
  const scored = []
  for (const pitfall of PITFALLS) {
    let score = 0
    let kind = ''
    const hits = []
    for (const pattern of pitfall.match) {
      const match = pattern.exec(source)
      if (match) {
        // A long literal match is a strong signal; a short one is weaker.
        score += match[0].length >= 8 ? 3 : 2
        if (!kind) kind = 'error'
        hits.push(match[0].slice(0, 60))
      }
    }
    for (const pattern of pitfall.symptom || []) {
      const match = pattern.exec(source)
      if (match) {
        score += 1
        if (!kind) kind = 'symptom'
        hits.push(match[0].slice(0, 60))
      }
    }
    if (score > 0) scored.push({ pitfall, score, kind, hits })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.pitfall.id.localeCompare(b.pitfall.id))
    .slice(0, Math.max(1, Number(limit) || 3))
}

export function pitfallMarkdown(item) {
  return [
    `## ${item.title}`,
    `**分类**：${item.category}`,
    '',
    `**原因**：${item.hint}`,
    '',
    '**先查**：',
    ...item.check.map((line) => `- \`${line}\``),
    '',
    '**处理**：',
    '```text',
    ...item.fix.map((line) => (line.startsWith('netlab_') ? line : line)),
    '```',
  ].join('\n')
}

export function pitfallIndexMarkdown(items = PITFALLS) {
  const rows = [
    '| id | 分类 | 坑 |',
    '| --- | --- | --- |',
    ...items.map((item) => `| \`${item.id}\` | ${item.category} | ${item.title} |`),
  ]
  return [
    '# eNSP / 华为现场踩坑知识库（20 条）',
    '',
    ...rows,
    '',
    '用 `netlab_reference topic=pitfall query=<关键词或错误信息>` 检索，或 `netlab_reference query=<报错原文>` 自动匹配。',
  ].join('\n')
}

export function pitfallMatchMarkdown(matches) {
  if (!matches.length) {
    return ['# 没有匹配到已知的坑', '', '把完整报错贴出来，我用分层排障卡现场分析。'].join('\n')
  }
  const parts = [`# 你可能踩了这些坑（${matches.length} 条）`, '']
  for (const match of matches) {
    parts.push(pitfallMarkdown(match.pitfall), '')
  }
  const allSymptoms = matches.every((item) => item.kind === 'symptom')
  parts.push(allSymptoms
    ? '> 这是按你描述的现象做的启发式匹配，不是设备报错；先按“先查”逐条确认再动手。'
    : '> 这是根据报错关键词的启发式匹配，确认后再动手。')
  return parts.join('\n')
}

export const PITFALL_CATEGORIES = [...new Set(PITFALLS.map((item) => item.category))]
