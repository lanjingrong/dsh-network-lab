const TOPICS = [
  {
    id: 'vlan',
    title: 'VLAN / Access / Trunk',
    keywords: ['vlan', 'trunk', 'access', 'pvid', '二层'],
    body: `## VLAN 与 Trunk 速查

\`\`\`text
vlan batch 10 20
interface GigabitEthernet0/0/1
 port link-type access
 port default vlan 10
 quit
interface GigabitEthernet0/0/24
 port link-type trunk
 port trunk allow-pass vlan 10 20
\`\`\`

验证：
- \`display vlan\`：VLAN 是否存在、哪些接口加入。
- \`display port vlan active\`：接口 PVID、链路类型、允许的 VLAN。
- \`display interface brief\`：接口是否 UP。

排障顺序：物理 UP → 链路类型 → PVID/allow-pass → PC 地址与掩码 → ARP。`,
  },
  {
    id: 'static-route',
    title: '静态路由',
    keywords: ['静态路由', 'route-static', '缺省路由', '下一跳'],
    body: `## 静态路由速查

\`\`\`text
ip route-static 192.168.2.0 255.255.255.0 10.0.0.2
ip route-static 0.0.0.0 0.0.0.0 200.1.1.2
\`\`\`

验证：
- \`display ip routing-table\`：目的网段、下一跳、出接口、协议。
- \`display ip routing-table protocol static\`：只看静态路由。
- \`display ip interface brief\`：接口地址和状态。

常见问题：只配单向路由、掩码写错、下一跳不可达、出接口写错。`,
  },
  {
    id: 'ospf',
    title: 'OSPF 单区域',
    keywords: ['ospf', '邻居', 'area', 'router-id', 'cost'],
    body: `## OSPF 单区域速查

\`\`\`text
ospf 1 router-id 1.1.1.1
 area 0
  network 10.1.1.0 0.0.0.255
  network 1.1.1.1 0.0.0.0
\`\`\`

验证：
- \`display ospf peer brief\`：邻居状态应到 Full。
- \`display ospf interface\`：区域、网络类型、Hello/Dead、cost。
- \`display ip routing-table protocol ospf\`：OSPF 路由。

邻居起不来：检查接口 UP、IP 同网段、Area 一致、Hello/Dead 一致、认证、router-id 冲突。`,
  },
  {
    id: 'nat',
    title: 'NAT / Easy IP',
    keywords: ['nat', 'easy ip', 'acl', 'outbound', '地址转换'],
    body: `## NAT Easy IP 速查

\`\`\`text
acl 2000
 rule 5 permit source 192.168.1.0 0.0.0.255
 quit
interface GigabitEthernet0/0/1
 nat outbound 2000
 quit
\`\`\`

验证：
- \`display current-configuration | include nat\`
- \`display acl 2000\`
- \`display nat session all\`（有流量后）

常见问题：ACL 反掩码错、NAT 配在内网口、没有默认路由、PC 网关不对。`,
  },
  {
    id: 'acl',
    title: 'ACL / 流量过滤',
    keywords: ['acl', 'traffic-filter', '安全', '五元组'],
    body: `## ACL 速查

基本 ACL（2000-2999）只匹配源 IP；高级 ACL（3000-3999）可匹配源/目的 IP、协议、端口。

\`\`\`text
acl 3000
 rule 5 deny tcp source 192.168.1.10 0 destination 192.168.2.10 0 destination-port eq 80
 rule 10 permit ip
 quit
interface GigabitEthernet0/0/0
 traffic-filter inbound acl 3000
 quit
\`\`\`

验证：
- \`display acl 3000\`
- \`display traffic-filter applied-record\`

注意：ACL 末尾默认拒绝所有；应用方向和接口要正确。`,
  },
  {
    id: 'dhcp',
    title: 'DHCP 服务器',
    keywords: ['dhcp', 'ip pool', '地址池', '租约'],
    body: `## DHCP 全局地址池速查

\`\`\`text
dhcp enable
ip pool vlan10
 network 192.168.10.0 mask 255.255.255.0
 gateway-list 192.168.10.1
 dns-list 8.8.8.8
 quit
interface GigabitEthernet0/0/0
 ip address 192.168.10.1 255.255.255.0
 dhcp select global
 quit
\`\`\`

验证：
- \`display ip pool\`
- \`display ip pool name vlan10 used\`
- PC 上 \`ipconfig /renew\`（Windows）或 \`dhclient\`（Linux）。

注意地址池网段必须和接口网段一致。`,
  },
  {
    id: 'stp',
    title: 'STP 防环',
    keywords: ['stp', '生成树', '根桥', '阻塞', '环路'],
    body: `## STP 速查

\`\`\`text
stp enable
stp priority 4096
\`\`\`

验证：
- \`display stp\`：根桥、桥优先级、根路径开销。
- \`display stp brief\`：端口角色（ROOT/DESI/ALTE）和状态。
- \`display stp interface GigabitEthernet0/0/1\`：单端口细节。

端口角色：ROOT 去往根桥；DESI 转发；ALTE 阻塞防环。阻塞不是故障。`,
  },
  {
    id: 'troubleshoot',
    title: '分层排障清单',
    keywords: ['排障', 'ping', 'tracert', 'display', '故障'],
    body: `## 分层排障清单

1. 物理/接口：\`display interface brief\`，看 UP/DOWN、错包。
2. 二层：\`display vlan\`、\`display port vlan active\`、\`display mac-address\`。
3. 三层：\`display ip interface brief\`、\`display arp\`、\`display ip routing-table\`。
4. 策略：\`display acl\`、\`display traffic-filter applied-record\`、\`display nat session all\`。
5. 应用：\`ping\`、\`tracert\`、\`telnet\` 端口测试。

先问“哪一层断了”，再问“这一层用什么命令证明”。不要一上来就删配置。`,
  },
]

export function referenceIndex() {
  return TOPICS.map((topic) => ({ id: topic.id, title: topic.title, keywords: topic.keywords }))
}

export function getReference(topic) {
  const key = String(topic || '').trim().toLowerCase()
  if (!key || key === 'all') return null
  const exact = TOPICS.find((item) => item.id === key)
  if (exact) return exact
  return TOPICS.find((item) =>
    item.title.toLowerCase().includes(key)
    || item.keywords.some((word) => word.toLowerCase().includes(key)),
  ) || null
}

export function searchReference(query) {
  const key = String(query || '').trim().toLowerCase()
  if (!key) return []
  return TOPICS.filter((item) =>
    item.title.toLowerCase().includes(key)
    || item.keywords.some((word) => word.toLowerCase().includes(key))
    || item.body.toLowerCase().includes(key),
  )
}
