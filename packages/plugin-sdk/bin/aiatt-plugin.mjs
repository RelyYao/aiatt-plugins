#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module';
const { run } = createRequire(import.meta.url)('../src/cli.js');
process.exitCode = await run(process.argv.slice(2));
