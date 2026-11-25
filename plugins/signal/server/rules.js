// SPDX-License-Identifier: Apache-2.0
// plugins/signal/server/rules.js — Operation Signal's board, pure: the word banks (English, Simplified, Traditional in
// ./words-tw.json), the 25 role cards (9 red, 8 blue, 7 bystanders, the assassin), the deal, and what makes a clue
// valid. The plugin (./index.js) plays by them; lib/games/signal/signal.js checks an Agent's clue with the same rule.
'use strict';
const WORDS_TW = require('./words-tw.json');
const WORDS_EN = ['lighthouse', 'ginkgo', 'carousel', 'pocket watch', 'greenhouse', 'wheat field', 'clock tower', 'ferry', 'amber', 'paper crane', 'laurel', 'waterfall', 'theater', 'stone bridge', 'pine forest', 'hourglass', 'rose', 'academy', 'wind chime', 'harbor', 'silver spoon', 'star chart', 'red wall', 'dove', 'secret letter'];
const WORDS_ZH = ['灯塔', '银杏', '木马', '怀表', '温室', '麦田', '钟塔', '渡船', '琥珀', '纸鹤', '月桂', '瀑布', '剧团', '石桥', '松林', '沙漏', '玫瑰', '书院', '风铃', '港湾', '银匙', '星图', '红墙', '白鸽', '密信'];
const ROLE_CARDS = [
  ...Array.from({ length: 9 }, () => ({ role: 'red-agent', team: 'red' })),
  ...Array.from({ length: 8 }, () => ({ role: 'blue-agent', team: 'blue' })),
  ...Array.from({ length: 7 }, () => ({ role: 'bystander', team: 'neutral' })),
  { role: 'assassin', team: 'neutral' },
];
const wordsFor = lang => lang === 'zh-TW' ? WORDS_TW : lang === 'zh-CN' ? WORDS_ZH : WORDS_EN;
// The board: 25 words of the language and the role cards, each shuffled with `shuffle` (the plugin's ctx.rng).
function deal(lang, shuffle) {
  const words = shuffle(wordsFor(lang)), roles = shuffle(ROLE_CARDS);
  return words.slice(0, 25).map((word, index) => ({ index, word, state: 'hidden', ...roles[index] }));
}
// A clue is one word of 1–20 characters that neither contains nor is contained in a board word, and a number 0–9.
// Returns the clue or a refusal.
function clueInput(cards, body) {
  const word = String((body && body.word) || '').trim(), lower = word.toLowerCase();
  if (!word || word.length > 20 || cards.some(card => card.word.toLowerCase().includes(lower) || lower.includes(card.word.toLowerCase()))) {
    return { code: 400, error: 'BAD_CLUE', message: 'A clue must be 1-20 characters and must not contain, or be contained in, a board word' };
  }
  const number = body && body.number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 9) return { code: 400, error: 'BAD_NUMBER', message: 'The clue number must be an integer from 0 to 9' };
  return { word, number };
}
module.exports = { WORDS_EN, WORDS_ZH, WORDS_TW, ROLE_CARDS, wordsFor, deal, clueInput };
