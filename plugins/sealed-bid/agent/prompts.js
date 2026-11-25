// SPDX-License-Identifier: Apache-2.0
// What an Agent is asked when it is its turn to bid. Preview it with: npx aiatt-plugin preview-prompts
module.exports = {
  bid: {
    instruction: (view, decision, t) => t('agent.bid', { round: view.round, rounds: view.rounds, lot: view.lot.name, appraisal: view.lot.appraisal, budget: view.budgets[view.you] }),
    answer: { type: 'object', properties: { amount: { type: 'integer', minimum: 0, maximum: 300 }, reason: { type: 'string', maxLength: 80 } }, required: ['amount', 'reason'] },
  },
};
