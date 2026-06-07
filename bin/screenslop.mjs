#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { run } from '../src/runtime/shell.mjs';
import { detectRuntimes } from '../src/runtime/detect.mjs';
import { collectSee } from '../src/evidence/collect-see.mjs';

const command = process.argv[2] || 'help';
const args = process.argv.slice(3);

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  case 'doctor':
    await doctor();
    break;
  case 'init':
    initProject();
    break;
  case 'see':
    await see();
    break;
  case 'critique':
  case 'fix':
  case 'matrix':
  case 'verify':
  case 'watch':
    placeholder(command);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(2);
}

/** Prints the command menu. */
function printHelp() {
  console.log(`Screenslop

Usage:
  screenslop <command> [options]

Commands:
  init       Create .screenslop/config.json
  doctor     Check Baguette, XcodeBuildMCP, Xcode, simctl, Swift, Node
             Use --install-baguette to install after confirmation
  see        Capture screenshot, accessibility tree, optional logs, and evidence
  critique   Review an evidence bundle (coming next)
  fix        Patch selected findings (coming next)
  matrix     Capture across devices/settings (coming next)
  verify     Recheck previous findings (coming next)
  watch      Live review loop (coming next)
`);
}

/** Checks runtime availability and offers safe setup help. */
async function doctor() {
  const detected = detectRuntimes();
  console.log('Screenslop doctor\n');
  console.log(`Preferred runtime: ${detected.preferred}\n`);

  for (const [name, info] of Object.entries(detected.tools)) {
    const mark = info.available ? 'ok ' : 'miss';
    const version = info.version ? ` — ${info.version}` : '';
    console.log(`${mark.padEnd(5)} ${name}${version}`);
  }

  if (!detected.tools.baguette.available) {
    console.log('\nBaguette is not installed. That is fine for now, but it is the runtime that makes Screenslop interesting.');
    console.log('Install path: brew install baguette');
    if (detected.tools.xcodebuildmcp.available) {
      console.log('XcodeBuildMCP is available, so Screenslop can use that as the next best fallback.');
    } else {
      console.log('XcodeBuildMCP is also missing.');
      console.log('Install options: brew tap getsentry/xcodebuildmcp && brew install xcodebuildmcp');
      console.log('Or: npm install -g xcodebuildmcp@latest');
    }

    const wantsInstall = args.includes('--install-baguette') || await confirmInstall();
    if (wantsInstall) {
      installBaguette();
    }
  }
}

/** Asks before running Homebrew. Package installs need explicit consent. */
async function confirmInstall() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const answer = await ask('Install Baguette with Homebrew now? [y/N] ');
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

/** Runs the Baguette install command after confirmation. */
function installBaguette() {
  console.log('\nRunning: brew install baguette\n');
  const result = run('brew install baguette');
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.log('\nInstall did not complete. Screenslop will keep using fallbacks for now.');
    process.exitCode = result.status || 1;
    return;
  }
  console.log('\nBaguette installed. Run `screenslop doctor` again to verify it.');
}

/** Reads a single line from stdin. */
function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Writes default project config without overwriting existing config. */
function initProject() {
  const dir = path.join(process.cwd(), '.screenslop');
  const file = path.join(dir, 'config.json');
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(file)) {
    console.log('.screenslop/config.json already exists. Leaving it alone because past-you may have had reasons.');
    return;
  }

  const detected = detectRuntimes();
  const config = {
    runtimePreference: ['baguette', 'xcodebuildmcp', 'simctl', 'manual'],
    preferredRuntime: detected.preferred,
    defaultSurface: null,
    defaultScheme: null,
    defaultBundleId: null,
    artifactsDir: 'artifacts',
    sourceHints: []
  };

  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log('Created .screenslop/config.json');
}

/** Captures an evidence bundle for the current screen. */
async function see() {
  const options = parseOptions(args);
  const result = await collectSee({
    root: process.cwd(),
    surface: options.values.surface || options.values.s || null,
    dryRun: options.flags.has('dry-run'),
    boot: options.flags.has('boot'),
    includeLogs: options.flags.has('logs'),
    udid: options.values.udid || null,
    device: options.values.device || null,
    deviceSet: options.values['device-set'] || null,
    bundleId: options.values['bundle-id'] || null,
    logDurationMs: Number(options.values['log-duration'] || 3000),
    confirmBoot
  });

  printSeeResult(result, options.flags.has('json'));
  if (!result.ok) process.exitCode = 1;
}

/** Prints placeholder status for commands not wired yet. */
function placeholder(name) {
  console.log(`screenslop ${name} is planned but not wired yet.`);
  console.log('Run `screenslop see --dry-run` to create the current evidence bundle scaffold.');
}

/**
 * Asks before booting a simulator from an interactive terminal.
 * @param {object} device Simulator device.
 * @returns {Promise<boolean>} True when the user approves booting.
 */
async function confirmBoot(device) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const answer = await ask(`No booted simulator found. Boot ${device.name} (${device.runtime}) now? [y/N] `);
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

/**
 * Prints `see` output for humans or agents.
 * @param {object} result Capture result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printSeeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Created evidence bundle: ${result.dir}`);
  console.log(`Runtime: ${result.runtime}`);
  if (result.device) console.log(`Device: ${result.device.name} (${result.device.udid})`);
  for (const step of result.capture?.steps || []) {
    console.log(`${step.ok ? 'ok ' : 'fail'} ${step.name}${step.message ? ` — ${step.message}` : ''}`);
  }
}

/**
 * Parses CLI flags and key/value options.
 * @param {string[]} rawArgs Command arguments.
 * @returns {{flags:Set<string>, values:Record<string,string>}}
 */
function parseOptions(rawArgs) {
  const flags = new Set();
  const values = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) continue;

    const key = arg.replace(/^-+/, '');
    const next = rawArgs[index + 1];
    if (next && !next.startsWith('-')) {
      values[key] = next;
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return { flags, values };
}
