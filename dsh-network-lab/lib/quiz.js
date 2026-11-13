const BANK = [
  {
    id: 'vlan-1',
    topic: 'VLAN',
    difficulty: '入门',
    question: 'VLAN 主要解决的是什么问题？',
    options: ['扩大广播域', '隔离广播域并提高二层安全性', '给接口自动分配 IP', '替代路由协议'],
    answer: 1,
    explanation: 'VLAN 把一个物理交换机划分成多个逻辑广播域，广播不会跨 VLAN 泛洪。',
  },
  {
    id: 'vlan-2',
    topic: 'VLAN',
    difficulty: '入门',
    question: '交换机 access 接口收到不带 VLAN 标签的帧时，通常如何处理？',
    options: ['丢弃', '打上该接口 PVID 后转发', '转发给所有 VLAN', '改成 trunk 标签'],
    answer: 1,
    explanation: 'access 接口按 PVID 给无标签帧打标签，PVID 默认是 VLAN 1。',
  },
  {
    id: 'vlan-3',
    topic: 'Trunk',
    difficulty: '入门',
    question: '两台交换机通过 trunk 互联，默认可能只允许哪个 VLAN 通过？',
    options: ['所有 VLAN', 'VLAN 1', 'VLAN 4094', '没有任何 VLAN'],
    answer: 1,
    explanation: '不少 VRP 版本 trunk 默认只允许 VLAN 1，需要 port trunk allow-pass vlan 显式放行。',
  },
  {
    id: 'stp-1',
    topic: 'STP',
    difficulty: '入门',
    question: 'STP 选举根桥时，比较的第一项是什么？',
    options: ['MAC 地址越小越优先', '桥优先级越小越优先', '端口数量越多越优先', '带宽越大越优先'],
    answer: 1,
    explanation: '先比较桥优先级（默认 32768），相同时再比较桥 MAC，越小越优先。',
  },
  {
    id: 'stp-2',
    topic: 'STP',
    difficulty: '进阶',
    question: 'STP 中处于阻塞状态的端口，主要作用是？',
    options: ['彻底坏掉，需要更换', '阻断环路，同时保留冗余链路', '转发所有广播', '只转发 VLAN 1'],
    answer: 1,
    explanation: '阻塞端口不转发业务流量，但参与 BPDU，链路故障时可重新收敛。',
  },
  {
    id: 'ospf-1',
    topic: 'OSPF',
    difficulty: '进阶',
    question: 'OSPF 邻居稳定建立后，display ospf peer brief 中通常显示什么状态？',
    options: ['Init', '2-Way', 'Full', 'Down'],
    answer: 2,
    explanation: '广播网络上 DR/BDR 与 DROther 之间是 2-Way，但完全邻接关系应达到 Full。',
  },
  {
    id: 'ospf-2',
    topic: 'OSPF',
    difficulty: '进阶',
    question: 'OSPF 中 router-id 的作用是？',
    options: ['标识一台 OSPF 路由器', '作为接口 MAC', '作为 VLAN ID', '作为 DNS 地址'],
    answer: 0,
    explanation: 'router-id 在 OSPF 域内唯一标识路由器，建议使用稳定的 loopback 地址。',
  },
  {
    id: 'ospf-3',
    topic: 'OSPF',
    difficulty: '进阶',
    question: 'OSPF 的 network 命令中，0.0.0.255 表示什么？',
    options: ['子网掩码', '反掩码（wildcard）', '区域号', '开销值'],
    answer: 1,
    explanation: 'OSPF network 使用反掩码，0 表示必须匹配，1 表示不关心。',
  },
  {
    id: 'route-1',
    topic: '路由',
    difficulty: '入门',
    question: '路由器转发报文时，如果有多条路由都能匹配目的地址，优先选择？',
    options: ['最早配置的路由', '掩码最长（最具体）的路由', '开销最大的路由', '随机一条'],
    answer: 1,
    explanation: '最长前缀匹配优先；同样长度再比较协议优先级和 cost。',
  },
  {
    id: 'route-2',
    topic: '静态路由',
    difficulty: '入门',
    question: '在以太网链路上配置静态路由，下一跳通常应写什么？',
    options: ['本机接口 MAC', '对端接口 IP 地址', '广播地址', '任意 DNS 地址'],
    answer: 1,
    explanation: '写对端下一跳地址可避免以太网链路上的代理 ARP/邻居解析问题。',
  },
  {
    id: 'nat-1',
    topic: 'NAT',
    difficulty: '进阶',
    question: 'Easy IP 的特点是什么？',
    options: ['使用公网接口地址做转换', '必须配置地址池', '只转换目的地址', '不需要 ACL'],
    answer: 0,
    explanation: 'Easy IP 直接借用出口接口的公网地址做源地址转换，适合拨号或地址不固定的出口。',
  },
  {
    id: 'nat-2',
    topic: 'NAT',
    difficulty: '进阶',
    question: 'NAT 通常配置在哪个位置？',
    options: ['内网接入层交换机', '连接外网的出口接口', '任意 loopback', 'PC 网卡'],
    answer: 1,
    explanation: 'NAT 在内外网边界设备上执行，通常在出口接口调用 nat outbound。',
  },
  {
    id: 'acl-1',
    topic: 'ACL',
    difficulty: '进阶',
    question: '高级 ACL（3000-3999）相比基本 ACL 能匹配什么？',
    options: ['只能匹配源 IP', '可匹配源/目的 IP、协议和端口', '只能匹配 MAC', '只能匹配 VLAN'],
    answer: 1,
    explanation: '高级 ACL 可匹配五元组信息，适合精细的流量控制。',
  },
  {
    id: 'acl-2',
    topic: 'ACL',
    difficulty: '进阶',
    question: 'ACL 规则中的 0.0.0.255 是什么？',
    options: ['子网掩码', '反掩码', '端口号', '优先级'],
    answer: 1,
    explanation: 'ACL 使用反掩码，0 表示该位必须匹配，1 表示忽略。',
  },
  {
    id: 'dhcp-1',
    topic: 'DHCP',
    difficulty: '入门',
    question: 'DHCP 客户端获取地址的典型报文顺序是？',
    options: ['Discover → Offer → Request → ACK', 'Offer → Discover → ACK → Request', 'Request → ACK → Discover → Offer', 'ACK → Request → Offer → Discover'],
    answer: 0,
    explanation: '即 DORA：Discover、Offer、Request、ACK。',
  },
  {
    id: 'arp-1',
    topic: 'ARP',
    difficulty: '入门',
    question: 'ARP 的主要作用是？',
    options: ['把 IP 地址解析为 MAC 地址', '把 MAC 解析为端口号', '分配 VLAN', '计算 OSPF 开销'],
    answer: 0,
    explanation: '同一广播域内，主机用 ARP 找到目标 IP 对应的 MAC 地址。',
  },
  {
    id: 'subnet-1',
    topic: '子网划分',
    difficulty: '入门',
    question: '192.168.1.0/26 每个子网可用的主机地址有多少个？',
    options: ['30', '62', '64', '126'],
    answer: 1,
    explanation: '/26 有 6 位主机位，2^6-2=62 个可用地址。',
  },
  {
    id: 'subnet-2',
    topic: '子网划分',
    difficulty: '进阶',
    question: '192.168.1.130/26 所在子网的网络地址是？',
    options: ['192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192'],
    answer: 2,
    explanation: '/26 的块大小是 64，130 落在 128-191 区间，网络地址是 192.168.1.128。',
  },
  {
    id: "env-1",
    topic: "环境与登录",
    difficulty: "入门",
    question: "第一次用 eNSP 连交换机时提示符是 <Huawei>，想改设备名应该进入哪个视图？",
    options: ["用户视图，直接 sysname 即可", "系统视图，先输入 system-view", "接口视图，先进入 interface", "协议视图，先输入 ospf"],
    answer: 1,
    explanation: "sysname 在系统视图下配置；<Huawei> 是用户视图，只能用查看类命令。",
  },
  {
    id: "env-2",
    topic: "环境与登录",
    difficulty: "入门",
    question: "在 VRP 用户视图 <Huawei> 下输入 save 后，系统通常会提示什么？",
    options: ["要求选择 y/n 确认是否保存", "直接保存且没有任何提示", "报错“命令不存在”", "进入系统视图"],
    answer: 0,
    explanation: "save 会让你交互确认；直接在 config 里批量执行命令时容易被这个提示卡住，所以 netlab_exec 用 save=true 显式处理。",
  },
  {
    id: "env-3",
    topic: "环境与登录",
    difficulty: "入门",
    question: "eNSP 里一台设备的通信端口（Telnet 端口）在哪里查看？",
    options: ["随便猜 2000 起", "右键设备 → 设置，里面有端口号", "在设备上用 display version 看", "在 PC 上用 ping 扫出来"],
    answer: 1,
    explanation: "右键设备选“设置”能看到串口/端口号，第一台通常是 2000；猜端口和扫描只能临时兜底。",
  },
  {
    id: "env-4",
    topic: "环境与登录",
    difficulty: "入门",
    question: "本地配置改完后，怎样确认真的写进了启动配置文件？",
    options: ["重启后能登录就算保存了", "display saved-configuration 与 display current-configuration 对比一致", "只要没报错就是保存了", "在 eNSP 图形界面点一下保存"],
    answer: 1,
    explanation: "只有 saved 和 current 一致才算落盘；eNSP 的图形界面“保存拓扑”不会替你保存设备配置。",
  },
  {
    id: "env-5",
    topic: "环境与登录",
    difficulty: "进阶",
    question: "console 口登录交换机时要做认证，下面哪个说法对？",
    options: ["console 口默认不需要任何配置", "需要配 user-interface console 0 加 authentication-mode password 或 aaa", "console 口只能用 SSH 登录", "console 口的认证在交换机外面做"],
    answer: 1,
    explanation: "console 是本地管理通道，靠 user-interface console 0 的认证模式保护；AAA 和 VTY 是远程 Telnet/SSH 那一路。",
  },
  {
    id: "iface-5",
    topic: "设备与接口",
    difficulty: "入门",
    question: "用 display 命令看配置时一屏显示不完，出现 ---- More ---- 应该怎么处理？",
    options: ["按 Ctrl+C 退出，然后分段查", "直接关掉 eNSP 重连", "按空格翻页、回车下移一行、任意其它键结束", "把显示器分辨率调大"],
    answer: 2,
    explanation: "---- More ---- 是分页提示：空格翻一屏、回车下移一行、任意其它键退出分页。新手常按 Ctrl+C 退出后逐条查，能查但慢；脚本和工具里用 screen-length 0 temporary 一次性关掉分页更稳。",
  },
  {
    id: "iface-1",
    topic: "设备与接口",
    difficulty: "入门",
    question: "display interface GigabitEthernet 0/0/1 的输出里，判断接口是否可用看哪两个关键点？",
    options: ["只看带宽数字", "物理状态 Physical 与协议状态 Protocol 是否都 up", "只看发出的包数量", "只看接口名"],
    answer: 1,
    explanation: "Physical up + Protocol up 才说明链路真正可用；只有 Physical up 而 Protocol down 说明二层协商或对端有问题。",
  },
  {
    id: "iface-2",
    topic: "设备与接口",
    difficulty: "入门",
    question: "进入接口配置 IP 地址前，正确的顺序是？",
    options: ["ip address 192.168.1.1 24 → interface ...", "先配路由再配 IP", "在用户视图直接配 IP", "interface GigabitEthernet 0/0/1 → ip address 192.168.1.1 255.255.255.0"],
    answer: 3,
    explanation: "IP 地址是接口属性，必须先进接口视图再配；地址后面跟掩码，也可以用 /24 的简写。",
  },
  {
    id: "iface-3",
    topic: "设备与接口",
    difficulty: "入门",
    question: "把一个三层接口 shutdown 之后，最直接的后果是？",
    options: ["接口仍然可以转发数据", "该接口变为 down，路由表里与之相关的直连路由失效", "自动删除该接口上的所有 VLAN", "设备会重启"],
    answer: 1,
    explanation: "shutdown 让接口 down，直连路由随之撤销，这是“路由表里少了条目”的常见原因之一。",
  },
  {
    id: "iface-4",
    topic: "设备与接口",
    difficulty: "进阶",
    question: "给互联接口写 description 的最大价值是什么？",
    options: ["增加带宽", "以后看配置时能立刻知道这条线接到哪台设备的哪个口", "提升安全性", "提高路由收敛速度"],
    answer: 1,
    explanation: "description 是写给三个月后的自己看的：To-R2-G0/0/1 比 GigabitEthernet0/0/0 好排查一万倍。",
  },
]

export const QUIZ_TOPICS = [...new Set(BANK.map((item) => item.topic))]

/** Full bank access for the fault-to-quiz bridge and diagnostics. */
export function allQuestions() {
  return BANK
}

/** Look up questions by id, preserving the requested order and skipping unknown ids. */
export function pickQuestions(ids = []) {
  const byId = new Map(BANK.map((item) => [item.id, item]))
  return ids.map((id) => byId.get(String(id))).filter(Boolean)
}

function shuffle(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function createQuiz({ topics = [], count = 5 } = {}) {
  const wanted = Array.isArray(topics) ? topics.filter(Boolean) : []
  const pool = wanted.length ? BANK.filter((item) => wanted.includes(item.topic)) : BANK
  if (!pool.length) throw new Error(`没有匹配的题目主题：${wanted.join(', ')}`)
  const size = Math.max(1, Math.min(Number(count) || 5, 10, pool.length))
  const chosen = shuffle(pool).slice(0, size)
  const id = `quiz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  return {
    id,
    questions: chosen.map(({ id: qid, topic, difficulty, question, options }) => ({
      id: qid,
      topic,
      difficulty,
      question,
      options,
    })),
    answers: chosen.map((item) => item.answer),
    explanations: chosen.map((item) => item.explanation),
  }
}

export function gradeQuiz(quiz, submitted) {
  if (!Array.isArray(submitted)) throw new Error('answers 必须是数组，例如 ["B","C","A"]')
  const details = quiz.questions.map((question, index) => {
    const raw = submitted[index]
    let picked = -1
    if (typeof raw === 'number') picked = raw
    else if (typeof raw === 'string' && raw.trim()) {
      const value = raw.trim().toUpperCase()
      if (/^[A-D]$/.test(value)) picked = value.charCodeAt(0) - 65
      else if (/^[1-4]$/.test(value)) picked = Number(value) - 1
    }
    const correct = picked === quiz.answers[index]
    return {
      id: question.id,
      question: question.question,
      picked: picked >= 0 ? String.fromCharCode(65 + picked) : '(未作答)',
      correct: String.fromCharCode(65 + quiz.answers[index]),
      isCorrect: correct,
      explanation: quiz.explanations[index],
    }
  })
  const score = details.filter((item) => item.isCorrect).length
  return {
    score,
    total: details.length,
    percent: Math.round((score / details.length) * 100),
    details,
  }
}
