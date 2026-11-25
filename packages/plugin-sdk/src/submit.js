// SPDX-License-Identifier: Apache-2.0
'use strict';
// `submit`: runs the whole test, builds, and writes dist/submission/ (the bundle, the report, a copy of the manifest and
// SUBMISSION.md: the checklist and the exact commands to open a pull request on the community repository). It prints
// the commands; it never pushes anything and never talks to the network.
const fs = require('node:fs');
const path = require('node:path');
const { loadHost } = require('./load-host');
const { runTest } = require('./run-tests');
const { build } = require('./build');
const { kb } = require('./util');
const SOURCE_ENTRIES = ['plugin.json', 'server', 'locales', 'agent', 'client', 'assets', 'README.md', 'LICENSE'];
const REPO = '<community-repo-url>';
function commands(dir, { id, version }, repo, submission) {
  const here = path.resolve(dir), branch = `plugin/${id}-${version}`;
  return [
    `git clone ${repo} aiatt-plugins && cd aiatt-plugins`,
    `git checkout -b ${branch}`,
    `mkdir -p plugins/${id}`,
    ...SOURCE_ENTRIES.filter(name => fs.existsSync(path.join(here, name))).map(name => `cp -R ${JSON.stringify(path.join(here, name))} plugins/${id}/`),
    `git add plugins/${id}`,
    `git commit -m "feat(plugin): ${id} ${version}"`,
    `git push -u origin ${branch}`,
    `gh pr create --title "plugin: ${id} ${version}" --body-file ${JSON.stringify(path.join(submission, 'SUBMISSION.md'))}`,
  ];
}
function document(report, built, steps, repo) {
  const { id, version } = report;
  return `# 提交：${id}@${version}

由 \`aiatt-plugin submit\` 生成。社区仓库的自动检查会把下面的检查重跑一遍；人工审核看玩法、文案、能力申请和提示模板。

## 检查结果

${report.stages.map(stage => `- ${stage.ok ? '通过' : '未通过'} ${stage.name}：${stage.summary}`).join('\n')}
${report.warnings.length ? `\n提醒：\n${report.warnings.map(w => `- ${w}`).join('\n')}\n` : ''}
## 构建产物

- \`server.js\`：${kb(built.report.bundle.bytes)}（gzip ${kb(built.report.bundle.gzipBytes)}），sha256 \`${built.report.bundle.sha256}\`
- \`plugin.json\` sha256 \`${built.report.manifestSha256}\`
- 源文件：${built.report.bundle.files.map(f => f.name).join('、')}

## 作者自查清单

- [ ] 玩法说明和文案已写（\`plugin.json\` 的 name、listing.description；\`locales/\` 至少 zh-CN 和 en）
- [ ] 在 \`aiatt-plugin dev\` 里完整玩过几局，用「时间旅行」看过关键步骤
- [ ] 隐藏信息（手牌、暗数字）只出现在对应座位的 \`view()\` 里，并在 \`secrets()\` 里声明
- [ ] 用 \`aiatt-plugin preview-prompts\` 看过 Agent 的提示和回答格式
- [ ] 清单里只申请了用得上的能力（capabilities）
- [ ] 代码和素材都是自己写的，或许可证与 Apache-2.0 兼容并注明了来源
- [ ] 不含密钥、个人信息、内部地址

## 提交步骤

先在 GitHub 上 fork 社区仓库，把下面的 \`${REPO}\` 换成你 fork 的地址。命令不会自动执行，逐条运行：

\`\`\`bash
${steps.join('\n')}
\`\`\`
`;
}
function submit(dir, { games, seed, fuzz, repo = REPO, graph = loadHost() } = {}) {
  dir = path.resolve(dir);
  const tested = runTest(dir, { graph, ...(games !== undefined ? { games } : {}), ...(seed !== undefined ? { seed } : {}), ...(fuzz !== undefined ? { fuzz } : {}) });
  if (!tested.ok) return { ok: false, test: tested };
  const built = build(dir, { graph });
  if (!built.ok) return { ok: false, test: tested, problems: built.problems };
  const submission = path.join(dir, 'dist', 'submission');
  fs.rmSync(submission, { recursive: true, force: true });
  fs.mkdirSync(submission, { recursive: true });
  fs.copyFileSync(built.file, path.join(submission, 'server.js'));
  fs.copyFileSync(path.join(dir, 'plugin.json'), path.join(submission, 'plugin.json'));
  const summary = { ...built.report, test: { games: tested.stages.find(s => s.name === 'simulate')?.report?.games ?? null, stages: tested.stages.map(({ name, ok, summary: text }) => ({ name, ok, summary: text })), warnings: tested.warnings } };
  fs.writeFileSync(path.join(submission, 'report.json'), JSON.stringify(summary, null, 2) + '\n');
  const steps = commands(dir, tested, repo, submission);
  fs.writeFileSync(path.join(submission, 'SUBMISSION.md'), document(tested, built, steps, repo));
  return { ok: true, test: tested, dir: submission, files: fs.readdirSync(submission).sort(), commands: steps };
}
module.exports = { submit, REPO };
