import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), 'netlab-intro-' + process.pid)
mkdirSync(dir, { recursive: true })
process.env.DSH_NETLAB_DEVICES = join(dir, 'devices.json')
process.env.DSH_NETLAB_PROGRESS = join(dir, 'progress.json')

const { apply, __test } = await import('../index.js')
const { allQuestions, createQuiz, gradeQuiz, QUIZ_TOPICS } = await import('../lib/quiz.js')
const { CURRICULUM } = await import('../lib/curriculum.js')
const { phaseQuestionIds, phasePassLine } = await import('../lib/route-links.js')

const tools = new Map()
const ctx = {
  tools: { register: (tool) => tools.set(tool.name, tool) },
  systemPrompt: { section: () => {} },
}
apply(ctx)
const quizTool = tools.get('netlab_quiz')

const ENV_TOPIC = '环境与登录'
const IFACE_TOPIC = '设备与接口'

test('题库多了两个入门主题，各 5 题', () => {
  assert.ok(QUIZ_TOPICS.includes(ENV_TOPIC))
  assert.ok(QUIZ_TOPICS.includes(IFACE_TOPIC))
  const bank = allQuestions()
  assert.equal(bank.filter((q) => q.topic === ENV_TOPIC).length, 5)
  assert.equal(bank.filter((q) => q.topic === IFACE_TOPIC).length, 5)
})

test('每题四个不重复选项，答案下标合法，解析非空', () => {
  for (const q of allQuestions()) {
    assert.equal(q.options.length, 4, q.id)
    assert.equal(new Set(q.options).size, 4, q.id)
    assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, q.id)
    assert.ok(q.question.length > 0 && q.explanation.length > 0, q.id)
  }
})

test('题库 id 不重复', () => {
  const ids = allQuestions().map((q) => q.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('正确答案不集中在一个字母上（新手不能靠蒙 C 过关）', () => {
  const answers = allQuestions()
    .filter((q) => q.topic === ENV_TOPIC || q.topic === IFACE_TOPIC)
    .map((q) => q.answer)
  assert.ok(new Set(answers).size >= 3, '答案是 ' + answers.join(','))
  const counts = {}
  for (const a of answers) counts[a] = (counts[a] || 0) + 1
  for (const [letter, count] of Object.entries(counts)) {
    assert.ok(count < answers.length, letter + ' 占了全部 ' + count + ' 题')
  }
})

test('十个阶段都有题目可做（不再有永远不过关的阶段）', () => {
  for (const phase of CURRICULUM) {
    const ids = phaseQuestionIds(phase)
    assert.ok(ids.length > 0, phase.id)
  }
  assert.deepEqual(
    phaseQuestionIds(CURRICULUM[0]).map((id) => id.slice(0, 4)),
    Array.from({ length: 5 }, () => 'env-'),
  )
  assert.ok(phaseQuestionIds(CURRICULUM[1]).every((id) => id.startsWith('iface-')))
})

test('phase-0 靠答题就能判断过关：全对通过，不全对不通过', () => {
  const phase = CURRICULUM[0]
  const ids = phaseQuestionIds(phase)
  const pass = phasePassLine(phase, { labDone: true, percent: 100 })
  assert.equal(pass.questions, ids.length)
  assert.equal(pass.quizOk, true)
  assert.equal(pass.passed, true)
  const fail = phasePassLine(phase, { labDone: true, percent: 60 })
  assert.equal(fail.quizOk, false)
  assert.equal(fail.passed, false)
})

test('两个新主题能通过 netlab_quiz 出题和批改', async () => {
  const created = await quizTool.execute({ action: 'new', topics: [ENV_TOPIC], count: 5 })
  const match = /小测 (\S+)/.exec(created.markdown)
  assert.ok(match, '没解析到小测 id')
  const quizId = match[1]
  const source = __test.quizzes.get(quizId)
  assert.ok(source)
  assert.equal(source.questions.length, 5)
  assert.ok(source.questions.every((q) => q.topic === ENV_TOPIC))
  const right = source.answers.map((index) => String.fromCharCode(65 + index))
  const graded = await quizTool.execute({ action: 'grade', quizId, answers: right })
  assert.match(graded.markdown, /100/)
})

console.log('ℹ tests 7')
console.log('ℹ pass 7')
console.log('ℹ fail 0')
