#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { run } from '../src/runtime/shell.mjs';
import { detectRuntimes } from '../src/runtime/detect.mjs';
import { collectSee } from '../src/evidence/collect-see.mjs';
import { collectCritique } from '../src/critique/collect-critique.mjs';
import { collectFix } from '../src/fix/collect-fix.mjs';

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
    await critique();
    break;
  case 'fix':
    await fix();
    break;
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
  critique   Review an evidence bundle
  fix        Plan and apply selected safe SwiftUI finding fixes
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


/** Plans and optionally applies deterministic fixes for critique findings. */
async function fix() {
  const options = parseOptions(args);
  const bundlePath = firstPositional(args);
  const findingIds = optionList(options, 'finding');

  try {
    const wantsApply = options.flags.has('apply') && !options.flags.has('dry-run');
    const wantsJson = options.flags.has('json');
    if (wantsApply && wantsJson && !options.flags.has('yes')) {
      throw new Error('Refusing JSON apply without --yes. JSON mode never prompts.');
    }
    const confirmed = wantsApply && !options.flags.has('yes')
      ? await confirmApply()
      : options.flags.has('yes');

    const result = await collectFix({
      root: process.cwd(),
      bundlePath,
      sourceRoot: options.values['source-root'] || process.cwd(),
      findingIds,
      apply: wantsApply,
      dryRun: options.flags.has('dry-run') || !wantsApply,
      yes: options.flags.has('yes'),
      confirmed,
      label: options.values.label || null,
      verifyCommand: options.values['verify-command'] || null
    });

    printFixResult(result, options.flags.has('json'));
  } catch (error) {
    if (options.flags.has('json')) {
      console.log(JSON.stringify({
        ok: false,
        command: 'fix',
        error: error.message
      }, null, 2));
    } else {
      console.error(`screenslop fix failed: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

/** Asks before applying source patches from an interactive terminal. */
async function confirmApply() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const answer = await ask('Apply Screenslop source patches now? [y/N] ');
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}


/** Reviews an evidence bundle and writes findings. */
async function critique() {
  const options = parseOptions(args);
  const bundlePath = firstPositional(args);

  try {
    const result = await collectCritique({
      root: process.cwd(),
      bundlePath
    });

    printCritiqueResult(result, options.flags.has('json'));
  } catch (error) {
    if (options.flags.has('json')) {
      console.log(JSON.stringify({
        ok: false,
        command: 'critique',
        error: error.message
      }, null, 2));
    } else {
      console.error(`screenslop critique failed: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

/**
 * Prints critique output for humans or agents.
 * @param {object} result Critique result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printCritiqueResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Critiqued evidence bundle: ${result.bundle}`);
  console.log(`Findings: ${result.summary.total}`);
  for (const level of ['P0', 'P1', 'P2', 'P3']) {
    const count = result.summary.bySeverity[level] || 0;
    if (count > 0) console.log(`${level}: ${count}`);
  }
  console.log(`findings: ${result.artifacts.findingsPath}`);
  console.log(`report: ${result.artifacts.reportPath}`);

  let printed = 0;
  for (const level of ['P0', 'P1', 'P2', 'P3']) {
    const findings = result.findings.filter((finding) => finding.severity === level);
    if (findings.length === 0) continue;
    console.log(`\n${level}`);
    for (const finding of findings) {
      if (printed >= 8) break;
      console.log(`- ${finding.id}: ${finding.title}`);
      printed += 1;
    }
  }
  if (result.findings.length > printed) console.log(`...${result.findings.length - printed} more finding(s)`);
}


/**
 * Prints fix output for humans or agents.
 * @param {object} result Fix result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printFixResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Prepared fix plan for: ${result.bundle}`);
  console.log(`Items: ${result.items.length}`);
  for (const [status, count] of Object.entries(result.summary || {})) {
    console.log(`${status}: ${count}`);
  }
  console.log(`fix plan: ${result.artifacts.fixPlanPath}`);
  console.log(`report: ${result.artifacts.reportPath}`);
  if (result.artifacts.sessionPath) console.log(`session: ${result.artifacts.sessionPath}`);

  for (const item of result.items.slice(0, 8)) {
    console.log(`- ${item.findingId}: ${item.status} — ${item.note}`);
  }
  if (result.items.length > 8) console.log(`...${result.items.length - 8} more item(s)`);
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
  const booleanFlags = new Set(['apply', 'boot', 'dry-run', 'install-baguette', 'json', 'logs', 'yes']);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) continue;

    const key = arg.replace(/^-+/, '');
    if (booleanFlags.has(key)) {
      flags.add(key);
      continue;
    }

    const next = rawArgs[index + 1];
    if (next && !next.startsWith('-')) {
      if (values[key]) values[key] = `${values[key]},${next}`;
      else values[key] = next;
      index += 1;
    } else {
      flags.add(key);
    }
  }

  return { flags, values };
}


/**
 * Returns the first non-option argument.
 * @param {string[]} rawArgs Command arguments.
 * @returns {string|null} Positional value.
 */
function firstPositional(rawArgs) {
  const booleanFlags = new Set(['apply', 'boot', 'dry-run', 'install-baguette', 'json', 'logs', 'yes']);
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) return arg;
    const key = arg.replace(/^-+/, '');
    if (booleanFlags.has(key)) continue;
    const next = rawArgs[index + 1];
    if (next && !next.startsWith('-')) index += 1;
  }
  return null;
}

/**
 * Returns comma-separated/repeated option values as a clean list.
 * @param {{values:Record<string,string>}} options Parsed options.
 * @param {string} key Option key.
 * @returns {string[]} Option values.
 */
function optionList(options, key) {
  const value = options.values[key];
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
