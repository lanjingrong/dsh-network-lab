/**
 * Glue between the three halves of the course: the phases in curriculum.js,
 * the hands-on labs in labs.js and the troubleshooting cases in faults.js.
 *
 * The phase table carries the intent (which lab to do first, which extra labs
 * to try, which topics to be quizzed on); this module turns that into concrete
 * tool calls, and derives everything else (related labs, faults, quiz bank)
 * from what each lab and fault actually contains, so the three lists cannot
 * drift apart again.
 */

import { CURRICULUM, phaseLabel } from './curriculum.js'
import { LABS, findLab } from './labs.js'
import { FAULTS, findFault } from './faults.js'
import { allQuestions } from './quiz.js'
import { PHASE_PLAN } from './route-plan.js'

/** Below this the phase is not done, however much of it was ticked off. */
export const PASS_PERCENT = 80

function planFor(phaseId) {
  return PHASE_PLAN[phaseId] || { main: [], more: [], faults: [], topics: [] }
}

/** Labs a phase asks for: the main one first, then the extras. */
function labsFor(phaseId) {
  const plan = planFor(phaseId)
  return [...plan.main, ...plan.more].filter((id) => findLab(id))
}

export function phaseLabs(phase) {
  const plan = planFor(phase.id)
  return {
    main: plan.main.filter((id) => findLab(id)),
    more: plan.more.filter((id) => findLab(id)),
  }
}

export function phaseFaults(phase) {
  return planFor(phase.id).faults.map((id) => findFault(id)).filter(Boolean)
}

/** Questions a phase is graded on: its topics, through the labs it touches. */
export function phaseQuestionIds(phase) {
  const plan = planFor(phase.id)
  const topics = new Set(plan.topics)
  for (const id of labsFor(phase.id)) {
    const lab = findLab(id)
    for (const tag of lab?.tags || []) if (TOPIC_ALIAS[tag]) topics.add(TOPIC_ALIAS[tag])
  }
  return allQuestions()
    .filter((question) => topics.has(question.topic))
    .map((question) => question.id)
}

/**
 * Lab tags are written for humans (二层, Trunk, Access); the quiz bank groups
 * questions by the exam topic, so a lab's tags are mapped onto those.
 */
const TOPIC_ALIAS = {
  VLAN: 'VLAN',
  Trunk: 'Trunk',
  Access: 'VLAN',
  STP: 'STP',
  OSPF: 'OSPF',
  路由: '路由',
  静态路由: '静态路由',
  NAT: 'NAT',
  ACL: 'ACL',
  DHCP: 'DHCP',
  ARP: 'ARP',
  子网划分: '子网划分',
  '环境与登录': '环境与登录',
  '设备与接口': '设备与接口',
}

/** Which phase teaches a lab, for the lab tool to point back at. */
export function phaseOfLab(labId) {
  for (const phase of CURRICULUM) {
    if (labsFor(phase.id).includes(labId)) return phase
  }
  return null
}

/** Which phase practises a fault case. */
export function phaseOfFault(faultId) {
  for (const phase of CURRICULUM) {
    if (planFor(phase.id).faults.includes(faultId)) return phase
  }
  return null
}

/** Phase ids whose pass line this quiz result clears. */
export function phasesPassedBy(quizIds) {
  const hit = new Set(quizIds || [])
  return CURRICULUM.filter((phase) => {
    const want = phaseQuestionIds(phase)
    return want.length > 0 && want.every((id) => hit.has(id))
  }).map((phase) => phase.id)
}

/** The pass line for one phase: do its lab, then clear its questions. */
export function phasePassLine(phase, { labDone = false, percent = null } = {}) {
  const questions = phaseQuestionIds(phase)
  // A phase without questions is proved by the lab alone (phase-0 and
  // phase-1 are device practice); demanding a quiz there would deadlock.
  const quizOk = questions.length === 0 || (percent !== null && percent >= PASS_PERCENT)
  return {
    phase: phase.id,
    lab: labsFor(phase.id)[0] || null,
    labDone,
    questions: questions.length,
    percent,
    quizOk,
    passed: Boolean(labDone && quizOk),
  }
}

export function passLineMarkdown(line, phase) {
  const mark = (ok) => (ok ? '[x]' : '[ ]')
  const parts = [`## 过关条件（${phaseLabel(phase)}）`, '']
  parts.push(`${mark(line.labDone)} 做完主实验${line.lab ? ` \`${line.lab}\`` : '（本阶段无内置实验，按任务书自建拓扑并完成验证）'}`)
  if (line.questions) {
    const score = line.percent === null ? '尚未测' : `${line.percent}%`
    parts.push(`${mark(line.quizOk)} 题目正确率 ≥ ${PASS_PERCENT}%（${score}，本阶段共 ${line.questions} 题）`)
  } else {
    parts.push('- 本阶段暂无对应题目，做完实验即可。')
  }
  parts.push('', line.passed ? '**已过关**，可以 `netlab_curriculum action=complete`。' : line.questions ? '还没过关：先做实验，再用 `netlab_quiz action=new topics=[...]` 测一次。' : '还没过关：做完主实验并用 `netlab_verify` 验证通过即可。')
  return parts.join('\n')
}

/** One phase as a checklist of concrete next actions. */
export function nextActionsMarkdown(phase) {
  const { main, more } = phaseLabs(phase)
  const faults = phaseFaults(phase)
  const questions = phaseQuestionIds(phase)
  const parts = [`## 接下来做什么（${phase.id}）`, '']
  if (main.length) parts.push('1. 主实验：' + main.map((id) => `\`netlab_lab action=show lab=${id}\``).join('、'))
  else parts.push('1. 主实验：本阶段以自建拓扑为主，按任务书自己搭')
  if (more.length) parts.push(`2. 扩展实验：${more.map((id) => `\`${id}\``).join('、')}`)
  if (faults.length) parts.push(`${more.length ? 3 : 2}. 做完后练故障：${faults.map((fault) => `\`netlab_fault action=show id=${fault.id}\``).join('、')}`)
  const topics = [...new Set(allQuestions().filter((q) => questions.includes(q.id)).map((q) => q.topic))]
  if (topics.length) parts.push(`- 自测：\`netlab_quiz action=new topics=${JSON.stringify(topics)} count=5\`，正确率 ≥ ${PASS_PERCENT}% 才算过关`)
  return parts.join('\n')
}

/** Everything a learner would be handed at the start of a phase. */
export function phaseBriefMarkdown(phase) {
  return [phaseMarkdownInline(phase), nextActionsMarkdown(phase)].join('\n\n')
}

function phaseMarkdownInline(phase) {
  return `# ${phase.title}\n**难度**：${phase.level}　**建议用时**：${phase.days}\n\n${phase.goal}`
}

/** Coverage check used by tests and by the route page. */
export function coverage() {
  const placed = new Map()
  for (const phase of CURRICULUM) {
    for (const id of labsFor(phase.id)) placed.set(id, phase.id)
  }
  return {
    labs: LABS.map((lab) => ({ id: lab.id, phase: placed.get(lab.id) || null })),
    faults: FAULTS.map((fault) => {
      const phase = phaseOfFault(fault.id)
      return { id: fault.id, phase: phase ? phase.id : null }
    }),
    emptyPhases: CURRICULUM.filter((phase) => !labsFor(phase.id).length).map((phase) => phase.id),
  }
}
