/**
 * Retry quizzes: rebuild the questions a learner got wrong into a fresh quiz.
 *
 * The point is that a wrong answer must be re-earned, not memorised by letter:
 * same questions, options re-ordered, so "答案 B" from last time is worthless.
 */

const BT = String.fromCharCode(96)
const b = (s) => BT + s + BT

/**
 * @param {{id:string, questions:Array}} sourceQuiz 上一次的测验
 * @param {{details:Array}} gradeResult gradeQuiz 的返回
 * @param {string} id 新测验 id
 * @returns {{id, questions, createdAt, retryOf}|null} 没有错题时返回 null
 */
export function buildRetryQuiz(sourceQuiz, gradeResult, id) {
  const wrong = new Set((gradeResult.details || []).filter((item) => !item.isCorrect).map((item) => item.id))
  const picked = (sourceQuiz.questions || []).filter((question) => wrong.has(question.id))
  if (!picked.length) return null
  const questions = []
  const answers = []
  const explanations = []
  picked.forEach((question, index) => {
    const correctIndex = Number.isInteger(question.answer)
      ? question.answer
      : (sourceQuiz.answers || [])[sourceQuiz.questions.indexOf(question)]
    const explanation = question.explanation || (sourceQuiz.explanations || [])[sourceQuiz.questions.indexOf(question)] || ''
    const order = question.options.map((_, optionIndex) => optionIndex)
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = (index * 7 + i * 3) % (i + 1)
      const swap = order[i]
      order[i] = order[j]
      order[j] = swap
    }
    const options = order.map((optionIndex) => question.options[optionIndex])
    questions.push({ ...question, options })
    answers.push(options.indexOf(question.options[correctIndex]))
    explanations.push(explanation)
  })
  return { id, questions, answers, explanations, createdAt: Date.now(), retryOf: sourceQuiz.id }
}

/**
 * Markdown for a retry quiz. Only the parts that differ from a normal quiz:
 * a header saying where the wrong answers came from, and the option letters.
 */
export function retryMarkdown(quiz, { percent = null } = {}) {
  const lines = []
  lines.push('# 错题重做 ' + quiz.id)
  const from = percent === null ? '' : '，那次得分 ' + percent + '%'
  lines.push('上次 ' + quiz.retryOf + ' 里做错的 ' + quiz.questions.length + ' 道题' + from + '。选项顺序已打乱，上次的答案字母作废。')
  lines.push('')
  quiz.questions.forEach((question, index) => {
    lines.push('**' + (index + 1) + '. [' + question.topic + '/' + question.difficulty + '] ' + question.question + '**')
    question.options.forEach((option, optionIndex) => {
      lines.push('- ' + String.fromCharCode(65 + optionIndex) + '. ' + option)
    })
    lines.push('')
  })
  lines.push('答完把字母按顺序传回来：' + b('netlab_quiz action=grade quizId=' + quiz.id + ' answers=[...]'))
  return lines.join('\n')
}

/** 批改重做题后追加的一句话：把错过的题标出来，全对就给下一步。 */
export function retryBackNote(entry, result) {
  if (!entry) return ''
  const head = '\n这是对 ' + entry.quizId + ' 的错题重做，那次得分 ' + entry.result.percent + '%。'
  if (!result) return head
  const stillWrong = result.details.filter((item) => !item.isCorrect).map((item) => item.id)
  if (!stillWrong.length) {
    return head + '\n**这次全对了**。花两分钟把刚才错的题讲一遍：错在哪、为什么、换个拓扑还成立吗；讲不顺就是还没掌握。'
  }
  return head + '\n还有 ' + stillWrong.length + ' 道没对：' + stillWrong.join('、') + '。先别急着重做，回去把对应知识点看一遍再试。'
}
