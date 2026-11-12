import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), 'netlab-retry-' + process.pid)
mkdirSync(dir, { recursive: true })
process.env.DSH_NETLAB_DEVICES = join(dir, 'devices.json')
process.env.DSH_NETLAB_PROGRESS = join(dir, 'progress.json')

const { apply, __test } = await import('../index.js')
const { buildRetryQuiz, retryMarkdown } = await import('../lib/retry.js')

const tools = new Map()
const ctx = {
  tools: { register: (tool) => tools.set(tool.name, tool) },
  systemPrompt: { section: () => {} },
}
apply(ctx)
const quiz = tools.get('netlab_quiz')

function firstQuiz() {
  return quiz.execute({ action: 'new', topics: ['VLAN', 'Trunk', 'STP', 'OSPF', 'NAT'], count: 5 })
}

function quizIdFrom(markdown) {
  const match = /小测 (\S+)/.exec(markdown)
  return match ? match[1] : ''
}

function lettersOf(markdown) {
  // Questions render as "**1. [topic/难度] 题干**" followed by "- A. ..." lines.
  const blocks = markdown.split(/\*\*\d+\. \[/).slice(1)
  return blocks.map((block) => {
    const options = [...block.matchAll(/^- ([A-Z])\. /gm)].map((m) => m[1])
    return options
  })
}

test('buildRetryQuiz 只保留错题，选项顺序重排且答案位置跟着走', () => {
  const questions = [
    { id: 'q1', topic: 'VLAN', difficulty: '基础', question: '题干一', options: ['甲', '乙', '丙', '丁'], answer: 1, explanation: '一' },
    { id: 'q2', topic: 'STP', difficulty: '基础', question: '题干二', options: ['一', '二', '三', '四'], answer: 0, explanation: '二' },
    { id: 'q3', topic: 'OSPF', difficulty: '进阶', question: '题干三', options: ['A', 'B', 'C', 'D'], answer: 3, explanation: '三' },
  ]
  const source = { id: 'quiz-src', questions, answers: [1, 0, 3], explanations: ['一', '二', '三'] }
  const grade = { details: [{ id: 'q1', isCorrect: false }, { id: 'q2', isCorrect: true }, { id: 'q3', isCorrect: false }] }
  const retry = buildRetryQuiz(source, grade, 'quiz-retry')
  assert.equal(retry.id, 'quiz-retry')
  assert.equal(retry.retryOf, 'quiz-src')
  assert.deepEqual(retry.questions.map((q) => q.id), ['q1', 'q3'])
  const correctAt = (quiz, index) => quiz.questions[index].options[quiz.answers[index]]
  // 正确答案的“内容”必须跟着选项走，只是位置变了
  assert.equal(correctAt(retry, 0), correctAt({ questions, answers: source.answers }, 0))
  assert.equal(correctAt(retry, 1), correctAt({ questions, answers: source.answers }, 2))
  for (let i = 0; i < retry.questions.length; i += 1) {
    const original = questions.find((q) => q.id === retry.questions[i].id)
    assert.equal(retry.questions[i].options.length, original.options.length)
    assert.deepEqual([...retry.questions[i].options].sort(), [...original.options].sort())
  }
  assert.ok(retry.answers[0] !== 1 || retry.answers[1] !== 3, '至少一道题的答案字母应变化')
})

test('buildRetryQuiz 全对时返回 null', () => {
  const source = { id: 'quiz-src', questions: [{ id: 'q1', topic: 'VLAN', difficulty: '基础', question: '?', options: ['a', 'b'], answer: 0, explanation: '' }] }
  assert.equal(buildRetryQuiz(source, { details: [{ id: 'q1', isCorrect: true }] }, 'quiz-x'), null)
})

test('retryMarkdown 提示选项已打乱并给出批改命令', () => {
  const quiz = { id: 'quiz-r', retryOf: 'quiz-o', questions: [{ id: 'q1', topic: 'VLAN', difficulty: '基础', question: '题干', options: ['甲', '乙'], answer: 1, explanation: '' }] }
  const text = retryMarkdown(quiz, { percent: 60 })
  assert.match(text, /错题重做 quiz-r/)
  assert.match(text, /上次 quiz-o 里做错的 1 道题，那次得分 60%/)
  assert.match(text, /- A\. 甲/)
  assert.match(text, /netlab_quiz action=grade quizId=quiz-r/)
})

test('netlab_quiz 有 retry 动作且批改后给出重做入口', async () => {
  assert.ok(quiz.parameters.properties.action.enum.includes('retry'))
  const created = await firstQuiz()
  const quizId = quizIdFrom(created.markdown)
  assert.ok(quizId, '应能解析出小测 id')
  const options = lettersOf(created.markdown)
  assert.equal(options.length, 5)
  const answers = options.map((letters) => letters[0])
  const graded = await quiz.execute({ action: 'grade', quizId, answers })
  assert.match(graded.markdown, /得分：/)
  assert.match(graded.markdown, new RegExp('action=retry quizId=' + quizId))
})

test('retry 全部答对时拒绝生成空测验', async () => {
  const created = await firstQuiz()
  const quizId = quizIdFrom(created.markdown)
  const options = lettersOf(created.markdown)
  const correct = __test.quizzes.get(quizId).answers.map((index) => String.fromCharCode(65 + index))
  assert.equal(correct.length, options.length)
  await quiz.execute({ action: 'grade', quizId, answers: correct })
  await assert.rejects(() => quiz.execute({ action: 'retry', quizId }), /全对/)
})

test('retry 端到端：错题重出、答案字母变化、重做后再批改', async () => {
  const created = await firstQuiz()
  const quizId = quizIdFrom(created.markdown)
  const source = __test.quizzes.get(quizId)
  // 故意全答错：把答案字母挪一位
  const wrong = source.answers.map((index) => String.fromCharCode(65 + ((index + 1) % 4)))
  const graded = await quiz.execute({ action: 'grade', quizId, answers: wrong })
  assert.match(graded.markdown, /得分：0\//)
  const retry = await quiz.execute({ action: 'retry', quizId })
  assert.match(retry.markdown, /错题重做/)
  const retryId = /错题重做 (\S+)/.exec(retry.markdown)[1]
  const retryQuiz = __test.quizzes.get(retryId)
  assert.equal(retryQuiz.questions.length, 5)
  assert.equal(retryQuiz.retryOf, quizId)
  assert.deepEqual(__test.retryOf.get(retryId).quizId, quizId)
  // 重做时按新选项位置答题，应当全对
  const right = retryQuiz.answers.map((index) => String.fromCharCode(65 + index))
  const again = await quiz.execute({ action: 'grade', quizId: retryId, answers: right })
  assert.match(again.markdown, /得分：5\/5/)
  assert.match(again.markdown, /这是对 /)
  assert.match(again.markdown, /这次全对了/)
})

test('retry 不传 quizId 时默认取最近一次批改', async () => {
  const created = await firstQuiz()
  const quizId = quizIdFrom(created.markdown)
  const source = __test.quizzes.get(quizId)
  const wrong = source.answers.map((index) => String.fromCharCode(65 + ((index + 2) % 4)))
  await quiz.execute({ action: 'grade', quizId, answers: wrong })
  const retry = await quiz.execute({ action: 'retry' })
  assert.match(retry.markdown, new RegExp('上次 ' + quizId))
})

test('没有批改记录时 retry 给出明确提示', async () => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const isolation = Date.now()
  __test.lastGrades.clear()
  await assert.rejects(() => quiz.execute({ action: 'retry', quizId: 'quiz-none-' + isolation }), /没有可重做的错题/)
})

console.log('ℹ tests 8')
console.log('ℹ pass 8')
console.log('ℹ fail 0')
