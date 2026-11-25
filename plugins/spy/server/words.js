// SPDX-License-Identifier: Apache-2.0
// plugins/spy/server/words.js — 卧底庄园词库（插件与游戏框架共用；lib/games/spy/spywords.js 转发到这里）：[平民词, 卧底词] 近似词对（运营可扩充，付费题库包的资产基础）
// 分层：easy（大众日常，开局友好）/ normal（有一定迷惑性）/ hard（高阶语义博弈）
'use strict';

const WORDS_ZH = {
  easy: [
    ['苹果', '梨'], ['牛奶', '豆浆'], ['包子', '馒头'], ['可乐', '雪碧'],
    ['口红', '唇彩'], ['雨伞', '雨衣'], ['筷子', '叉子'], ['沙发', '躺椅'],
    ['牙刷', '牙膏'], ['手机', '平板'], ['台灯', '蜡烛'], ['书包', '背包'],
    ['西瓜', '哈密瓜'], ['面包', '蛋糕'], ['足球', '篮球'], ['铅笔', '钢笔'],
    ['地铁', '公交'], ['被子', '毯子'], ['镜子', '玻璃'], ['闹钟', '手表'],
    ['火锅', '麻辣烫'], ['奶茶', '咖啡'], ['短信', '微信'], ['眼镜', '墨镜'],
    ['枕头', '抱枕'], ['拖鞋', '凉鞋'], ['电动车', '摩托车'], ['电梯', '扶梯'],
  ],
  normal: [
    ['演员', '歌手'], ['医生', '护士'], ['老师', '教授'], ['警察', '保安'],
    ['和尚', '道士'], ['新娘', '伴娘'], ['房东', '租客'], ['老板', '总裁'],
    ['散文', '诗歌'], ['钢琴', '电子琴'], ['油画', '素描'], ['相声', '小品'],
    ['春节', '元旦'], ['中秋', '端午'], ['婚礼', '订婚'], ['生日', '满月'],
    ['加班', '值班'], ['辞职', '退休'], ['考试', '补考'], ['奖学金', '助学金'],
    ['网购', '代购'], ['直播', '录播'], ['粉丝', '黑粉'], ['网红', '明星'],
    ['双十一', '618'], ['外卖', '跑腿'], ['快递', '外卖'], ['打车', '拼车'],
    ['健身', '瑜伽'], ['减肥', '增肌'], ['失眠', '熬夜'], ['追剧', '刷短视频'],
    ['相亲', '约会'], ['彩礼', '嫁妆'], ['房贷', '房租'], ['股票', '基金'],
    ['方言', '口音'], ['普通话', '粤语'], ['宠物', '野兽'], ['动物园', '植物园'],
  ],
  hard: [
    ['自由', '孤独'], ['梦想', '执念'], ['勇敢', '鲁莽'], ['谦虚', '自卑'],
    ['沉默', '冷漠'], ['浪漫', '矫情'], ['成熟', '世故'], ['天真', '愚蠢'],
    ['回忆', '遗憾'], ['青春', '年少'], ['命运', '运气'], ['缘分', '巧合'],
    ['内卷', '努力'], ['躺平', '摆烂'], ['精致', '奢侈'], ['实用', '廉价'],
    ['偶像', '榜样'], ['争议', '话题'], ['经典', '流行'], ['小众', '冷门'],
    ['算法', '模型'], ['代码', '程序'], ['人工智能', '机器学习'], ['云计算', '边缘计算'],
    ['元宇宙', '虚拟现实'], ['自动驾驶', '辅助驾驶'], ['便利店', '自动售货机'], ['图书馆', '自习室'],
  ],
};

// English pool (default for the overseas launch). Pairs are close-but-different so descriptions stay ambiguous.
const WORDS_EN = {
  easy: [
    ['apple', 'pear'], ['milk', 'yogurt'], ['bagel', 'donut'], ['cola', 'lemonade'],
    ['lipstick', 'lip gloss'], ['umbrella', 'raincoat'], ['fork', 'spoon'], ['sofa', 'armchair'],
    ['toothbrush', 'toothpaste'], ['phone', 'tablet'], ['lamp', 'candle'], ['backpack', 'suitcase'],
    ['watermelon', 'cantaloupe'], ['bread', 'cake'], ['soccer', 'basketball'], ['pencil', 'pen'],
    ['subway', 'bus'], ['blanket', 'duvet'], ['mirror', 'window'], ['alarm clock', 'wristwatch'],
    ['pizza', 'burger'], ['tea', 'coffee'], ['text message', 'email'], ['glasses', 'sunglasses'],
    ['pillow', 'cushion'], ['slippers', 'sandals'], ['scooter', 'motorcycle'], ['elevator', 'escalator'],
  ],
  normal: [
    ['actor', 'singer'], ['doctor', 'nurse'], ['teacher', 'professor'], ['police officer', 'security guard'],
    ['monk', 'priest'], ['bride', 'bridesmaid'], ['landlord', 'tenant'], ['boss', 'CEO'],
    ['novel', 'poem'], ['piano', 'keyboard'], ['painting', 'sketch'], ['stand-up', 'sitcom'],
    ['Christmas', 'Thanksgiving'], ['Halloween', 'carnival'], ['wedding', 'engagement'], ['birthday', 'anniversary'],
    ['overtime', 'night shift'], ['quitting', 'retiring'], ['exam', 'quiz'], ['scholarship', 'grant'],
    ['online shopping', 'thrift store'], ['livestream', 'podcast'], ['fan', 'hater'], ['influencer', 'celebrity'],
    ['Black Friday', 'Cyber Monday'], ['takeout', 'delivery'], ['courier', 'mail carrier'], ['taxi', 'rideshare'],
    ['gym', 'yoga'], ['dieting', 'bulking'], ['insomnia', 'all-nighter'], ['binge-watching', 'doomscrolling'],
    ['blind date', 'first date'], ['mortgage', 'rent'], ['stocks', 'index fund'], ['accent', 'dialect'],
    ['pet', 'wild animal'], ['zoo', 'aquarium'], ['museum', 'gallery'], ['camping', 'glamping'],
  ],
  hard: [
    ['freedom', 'loneliness'], ['dream', 'obsession'], ['brave', 'reckless'], ['humble', 'insecure'],
    ['silence', 'indifference'], ['romantic', 'cheesy'], ['mature', 'jaded'], ['naive', 'foolish'],
    ['memory', 'regret'], ['youth', 'childhood'], ['fate', 'luck'], ['destiny', 'coincidence'],
    ['hustle', 'burnout'], ['chilling', 'slacking'], ['elegant', 'extravagant'], ['practical', 'cheap'],
    ['idol', 'role model'], ['controversy', 'hot topic'], ['classic', 'trend'], ['niche', 'obscure'],
    ['algorithm', 'model'], ['code', 'program'], ['artificial intelligence', 'machine learning'], ['cloud', 'edge computing'],
    ['metaverse', 'virtual reality'], ['self-driving', 'cruise control'], ['convenience store', 'vending machine'], ['library', 'study hall'],
  ],
};
const WORDS = WORDS_EN;

// 按难度抽一对：{civilian, spy, difficulty}。随机数由调用方给（插件用对局种子的 ctx.rng，可重放）。
function pickWordPair(difficulty, opts = {}) {
  const random = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const bank = opts && opts.lang === 'zh-TW' ? require('./words-tw.json') : opts && opts.lang === 'zh-CN' ? WORDS_ZH : WORDS_EN;
  const pool = bank[difficulty] ? [difficulty] : ['easy', 'normal', 'hard'];
  const d = pool[Math.floor(random() * pool.length)];
  const list = bank[d];
  const pair = list[Math.floor(random() * list.length)];
  // 随机互换 A/B 位置，防止"第一个词总是平民"的统计规律
  const flip = random() < 0.5;
  return { civilian: flip ? pair[1] : pair[0], spy: flip ? pair[0] : pair[1], difficulty: d };
}

module.exports = { WORDS, WORDS_EN, WORDS_ZH, pickWordPair };
