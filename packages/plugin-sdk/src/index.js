// SPDX-License-Identifier: Apache-2.0
'use strict';
// @aiatt/plugin-sdk: the commands as functions (the CLI is a thin layer over these).
const { loadHost, locate } = require('./load-host');
const { check, loadPlugin } = require('./runtime');
const { runTest } = require('./run-tests');
const { fuzz } = require('./fuzz');
const { scanSource } = require('./scan');
const { build } = require('./build');
const { scaffold } = require('./scaffold');
const { createSimulator } = require('./simulator');
const { Session } = require('./session');
const { previewPrompts } = require('./prompts');
const { replayLog, readLog } = require('./replay');
const { submit } = require('./submit');
const { run } = require('./cli');
module.exports = { loadHost, locate, check, loadPlugin, test: runTest, fuzz, scanSource, build, scaffold, createSimulator, Session, previewPrompts, replayLog, readLog, submit, run };
