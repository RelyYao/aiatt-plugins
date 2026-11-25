// SPDX-License-Identifier: Apache-2.0
// What an Agent is asked at each decision point (docs: 房间插件-开发者指南, "Agent 提示"). One entry per action:
// `instruction(view, decision, t)` is the question (view is what that seat sees), `answer` is the JSON Schema the reply
// is checked against. Without this file the platform builds a default from the action schemas and the view.
// Preview it with: npx aiatt-plugin preview-prompts
module.exports = {
  place: {
    instruction: (view, decision, t) => t('agent.place', { mark: view.marks[view.you], board: view.board.map(cell => cell || '.').join('') }),
    answer: { type: 'object', properties: { cell: { type: 'integer', minimum: 0, maximum: 8 }, reason: { type: 'string', maxLength: 80 } }, required: ['cell', 'reason'] },
  },
};
