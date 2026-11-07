/**
 * 故障 → 题目联动。
 * 每个故障案例绑定主题和若干题；练习完立刻出题，才算“练完就测”闭环。
 * 优先用显式 questionIds，找不到时按主题回退到题库。
 */
import { allQuestions, pickQuestions } from './quiz.js'

export const FAULT_QUIZ = {
  'f01-vlan-mismatch': {
    topics: ['VLAN', 'Trunk'],
    questionIds: ['vlan-3', 'vlan-2', 'vlan-1'],
    focus: 'trunk 默认只放行 VLAN 1、access PVID 打标签',
  },
  'f02-access-pvid': {
    topics: ['VLAN'],
    questionIds: ['vlan-2', 'vlan-1', 'vlan-3'],
    focus: 'PVID 决定无标签帧归入哪个 VLAN',
  },
  'f03-gateway-missing': {
    topics: ['NAT', '路由'],
    questionIds: ['route-1', 'nat-2', 'nat-1'],
    focus: '缺省路由与 NAT 的配合',
  },
  'f04-ospf-area': {
    topics: ['OSPF'],
    questionIds: ['ospf-3', 'ospf-1', 'ospf-2'],
    focus: '区域号、反掩码、邻居状态',
  },
  'f05-acl-direction': {
    topics: ['ACL'],
    questionIds: ['acl-1', 'acl-2', 'route-1'],
    focus: 'ACL 反掩码、规则顺序、应用方向',
  },
  'f06-stp-loop': {
    topics: ['STP'],
    questionIds: ['stp-1', 'stp-2', 'vlan-1'],
    focus: '根桥选举与阻塞端口',
  },
  'f07-dhcp-pool': {
    topics: ['DHCP', 'ARP'],
    questionIds: ['dhcp-1', 'arp-1', 'subnet-1'],
    focus: 'DORA 流程与地址池一致性',
  },
  'f08-trunk-native': {
    topics: ['Trunk', 'VLAN'],
    questionIds: ['vlan-3', 'vlan-2', 'vlan-1'],
    focus: 'trunk 默认 VLAN 与跨厂商对齐',
  },
  'f09-aaa-lockout': {
    topics: ['VLAN'],
    questionIds: ['vlan-1', 'vlan-2'],
    focus: '管理面配置要留退路（console）',
  },
  'f10-save-lost': {
    topics: ['VLAN', '路由'],
    questionIds: ['vlan-1', 'route-2'],
    focus: 'running-config 与 saved-configuration',
  },
  'f11-vlanif-shutdown': {
    topics: ['VLAN', 'ARP'],
    questionIds: ['vlan-2', 'arp-1', 'subnet-2'],
    focus: 'VLANIF UP 条件与网关',
  },
  'f12-compound-nat': {
    topics: ['NAT', 'ACL', '路由'],
    questionIds: ['nat-1', 'nat-2', 'acl-1', 'acl-2'],
    focus: '复合故障：两个原因叠加，一个命令修不好',
  },
}

export function faultQuestionIds(faultId) {
  return FAULT_QUIZ[String(faultId || '').trim()]?.questionIds || []
}

export function faultTopics(faultId) {
  return FAULT_QUIZ[String(faultId || '').trim()]?.topics || []
}

export function faultQuizPlan(fault) {
  const plan = FAULT_QUIZ[fault.id]
  if (plan) {
    const questions = pickQuestions(plan.questionIds)
    if (questions.length) {
      return { source: 'bound', topics: plan.topics, focus: plan.focus, questions }
    }
  }
  // Fallback: any bank question whose topic matches the fault layer keywords.
  const keywords = `${fault.layer} ${fault.title}`
  const guessed = allQuestions().filter((item) =>
    keywords.includes(item.topic) || fault.tags?.includes(item.topic))
  return {
    source: guessed.length ? 'topic' : 'none',
    topics: [...new Set(guessed.map((item) => item.topic))],
    focus: '按故障关键词匹配的题目',
    questions: guessed.slice(0, 4),
  }
}

/**
 * Build a ready-to-grade quiz object from a fault, in the same shape createQuiz returns,
 * so gradeQuiz can score it without going through the quiz store.
 */
export function quizFromFault(fault) {
  const plan = faultQuizPlan(fault)
  if (!plan.questions.length) return null
  return {
    id: `quiz-${fault.id}-${Date.now().toString(36)}`,
    faultId: fault.id,
    focus: plan.focus,
    questions: plan.questions.map((item) => ({
      id: item.id,
      topic: item.topic,
      difficulty: item.difficulty,
      question: item.question,
      options: item.options,
    })),
    answers: plan.questions.map((item) => item.answer),
    explanations: plan.questions.map((item) => item.explanation),
  }
}

export function quizPlanMarkdown(fault, quiz) {
  if (!quiz) {
    return `\n\n> 这个故障（\`${fault.id}\`）暂时没有配套题目，可以 \`netlab_quiz action=new topics=["${fault.layer}"]\` 手动出题。`
  }
  const lines = [
    '',
    '---',
    `## 练完就测：${fault.title}（${quiz.questions.length} 题）`,
    `**考察重点**：${quiz.focus}`,
    '',
  ]
  quiz.questions.forEach((question, index) => {
    lines.push(`**${index + 1}. [${question.topic}] ${question.question}**`)
    question.options.forEach((option, optionIndex) => {
      lines.push(`- ${String.fromCharCode(65 + optionIndex)}. ${option}`)
    })
    lines.push('')
  })
  lines.push(`作答后：\`netlab_quiz action=grade quizId=${quiz.id} answers=["B","C","A"]\``)
  return lines.join('\n')
}
