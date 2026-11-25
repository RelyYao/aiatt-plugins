// SPDX-License-Identifier: Apache-2.0
'use strict';
// `request`: a platform request (the plugin needs something the platform does not offer) written as the
// "Platform request" issue form expects it, with the plugin's id and version and its test run filled in. It writes
// dist/request/REQUEST.md for the author to complete; it never sends anything. Post it as a task in 插件工坊 (the
// creator Agent files it) or open an issue with the "平台需求 / Platform request" template on the community repository.
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { runTest } = require('./run-tests');
const KINDS = ['新能力 / New capability', '宿主接口（ctx、生命周期、房主动作）/ Host interface', '限额（调用时长、状态大小）/ Limits', '默认界面和前端组件 / Default UI', 'Agent 驱动（决策点、提示）/ Agent driving', '结算和计费 / Settlement and pricing', '缺陷 / Bug'];
function request(dir, { title = '', kind = 0, games = 4, fuzz = 50, graph = loadHost() } = {}) {
  dir = path.resolve(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
  // The test run goes in as evidence; a failing test is fine here (it may be exactly what the request is about).
  let tested = null; try { tested = runTest(dir, { graph, games, fuzz }); } catch (error) { tested = { ok: false, stages: [], problems: [String(error.message)] }; }
  const stages = (tested.stages || []).map(s => `- ${s.ok ? '通过' : '未通过'} ${s.name}：${s.summary}`).join('\n') || '- （测试没能运行）';
  const problems = (tested.problems || []).slice(0, 10).map(p => `- ${p}`).join('\n');
  const text = `# 平台需求：${title || '（一句话写清需要什么）'}

## 插件 / Plugin
${manifest.id}@${manifest.version}

## 类别 / Kind
${KINDS[kind] || KINDS[0]}

## 想做什么 / What players should get
（玩家看到的效果，一两句话）

## 卡在哪 / What stops you
（现有接口为什么做不到，试过哪些写法）

## 复现 / Reproduction
（一个最小插件和步骤：在 \`npx aiatt-plugin dev\` 或 \`test\` 里能看到做不到或报错。平台交付后，同一个复现就是验收）

## 建议的接口（可选）/ Suggested interface

## 还有谁用得上 / Who else benefits

## 本地测试结果（自动填写）
${stages}
${problems ? `\n问题：\n${problems}\n` : ''}
---
提交方式：在平台的「插件工坊」里新建任务，标题写上面的需求，描述贴这份内容（插件管家会整理并提交到社区仓库）；或者在社区仓库用「平台需求」模板开 issue。安全问题不要这样提，按 SECURITY.md 私下报告。
`;
  const out = path.join(dir, 'dist', 'request');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'REQUEST.md'), text);
  return { ok: true, file: path.join(out, 'REQUEST.md'), plugin: `${manifest.id}@${manifest.version}`, tested: !!tested?.ok };
}
module.exports = { request, KINDS };
