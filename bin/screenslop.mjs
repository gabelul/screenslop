#!/usr/bin/env node
import path from 'node:path';
import readline from 'node:readline';
import { run } from '../src/runtime/shell.mjs';
import { detectRuntimes } from '../src/runtime/detect.mjs';
import { collectSee } from '../src/evidence/collect-see.mjs';
import { collectCritique } from '../src/critique/collect-critique.mjs';
import { collectFix } from '../src/fix/collect-fix.mjs';
import { collectVerify } from '../src/verify/collect-verify.mjs';
import { collectMatrix } from '../src/matrix/collect-matrix.mjs';
import { collectDesignProfile } from '../src/design/profile.mjs';
import { collectDesignReview } from '../src/design/review.mjs';
import { buildAgentInstructions, formatAgentInstructions } from '../src/agent-instructions.mjs';
import { chooseSetupDefaults, detectAppleProject } from '../src/config/project-detection.mjs';
import {
  createDefaultConfig,
  planInitConfig,
  readProjectConfig,
  resolveTargetConfig,
  writeProjectConfig
} from '../src/config/project-config.mjs';

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
  case 'setup':
    await setupProject();
    break;
  case 'instructions':
  case 'agent-bootstrap':
    instructions();
    break;
  case 'init':
    await initProject();
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
  case 'verify':
    await verify();
    break;
  case 'matrix':
    await matrix();
    break;
  case 'learn':
    await learn();
    break;
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
  setup      Detect project metadata and plan first-use config
  instructions Print the coding-agent contract and skill status
  init       Create .screenslop/config.json
  doctor     Check Baguette, XcodeBuildMCP, Xcode, simctl, Swift, Node
             Use --install-baguette to install after confirmation
  see        Capture screenshot, accessibility tree, optional logs, and evidence
  critique   Review an evidence bundle
  fix        Plan and apply selected safe SwiftUI finding fixes
  matrix     Write a bounded six-cell device/settings report
  learn      Learn, check, or refresh the private design profile
  verify     Compare previous findings with fresh evidence
  watch      Live review loop (coming next)
`);
}

/** Prints the Screenslop coding-agent contract. */
function instructions() {
  const options = parseOptions(args);
  const payload = buildAgentInstructions({
    agent: options.values.agent || 'generic',
    root: process.cwd()
  });
  process.stdout.write(formatAgentInstructions(payload, options.flags.has('json')));
}

/** Captures or scaffolds a bounded matrix report. */
async function matrix() {
  const options = parseOptions(args);
  try {
    const result = await collectMatrix({
      root: process.cwd(),
      profilePath: options.values.profile || null,
      dryRun: options.flags.has('dry-run'),
      includeCritique: options.flags.has('critique')
    });
    printMatrixResult(result, options.flags.has('json'));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    if (options.flags.has('json')) {
      console.log(JSON.stringify({ ok: false, command: 'matrix', error: error.message }, null, 2));
    } else {
      console.error(`screenslop matrix failed: ${error.message}`);
    }
    process.exitCode = 1;
  }
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


/** Detects app metadata and creates project config after explicit confirmation. */
async function setupProject() {
  const options = parseOptions(args);
  if (options.flags.has('help') || options.flags.has('h')) {
    printSetupHelp();
    return;
  }

  const detection = detectAppleProject(process.cwd());
  const choice = chooseSetupDefaults(detection, options.values);
  const wantsJson = options.flags.has('json');

  if (!choice.ok) {
    printSetupResult({
      ok: false,
      command: 'setup',
      status: 'needs-selection',
      wrote: false,
      dryRun: options.flags.has('dry-run'),
      detection,
      missing: choice.missing,
      ambiguous: choice.ambiguous,
      values: choice.values,
      next: setupSelectionNext(choice)
    }, wantsJson);
    process.exitCode = 1;
    return;
  }

  const plan = planInitConfig({
    root: process.cwd(),
    detected: detectRuntimes(),
    values: choice.values
  });

  try {
    if (!plan.ok) throw new Error(plan.error);

    const shouldWrite = await shouldWriteSetupConfig(plan, options);
    if (shouldWrite) writeProjectConfig(process.cwd(), plan.config);

    const refusedWrite = plan.action !== 'exists' && !shouldWrite && !options.flags.has('dry-run');
    printSetupResult({
      ...plan,
      ok: !refusedWrite,
      command: 'setup',
      status: refusedWrite ? 'requires-write-confirmation' : 'ready',
      wrote: shouldWrite,
      dryRun: options.flags.has('dry-run'),
      detection,
      missing: [],
      ambiguous: {},
      values: choice.values,
      next: setupReadyNext(plan.config)
    }, wantsJson);

    if (refusedWrite) process.exitCode = 1;
  } catch (error) {
    printSetupResult({
      ok: false,
      command: 'setup',
      action: plan.action,
      status: 'failed',
      error: error.message,
      file: plan.file,
      config: plan.config || null,
      wrote: false,
      dryRun: options.flags.has('dry-run'),
      detection,
      missing: [],
      ambiguous: {},
      values: choice.values,
      next: []
    }, wantsJson);
    process.exitCode = 1;
  }
}

/** Prints setup-specific options. */
function printSetupHelp() {
  console.log(`Screenslop setup

Usage:
  screenslop setup [options]

Options:
  --json                 Print machine-readable output
  --dry-run              Show the config plan without writing files
  --yes                  Skip interactive confirmation for writes
  --workspace <path>     Xcode workspace path
  --project <path>       Xcode project path
  --scheme <name>        Default scheme
  --bundle-id <id>       Default app bundle ID
  --device <name>        Default simulator device
  --source-root <path>   Source root for future apply flows
  --surface <name>       Default surface name for capture/report context
  --artifacts-dir <path> Artifact output directory
`);
}

/**
 * Decides whether setup may write project config.
 * @param {object} plan Init plan.
 * @param {{flags:Set<string>}} options Parsed CLI options.
 * @returns {Promise<boolean>} True when writing is allowed.
 */
async function shouldWriteSetupConfig(plan, options) {
  if (options.flags.has('dry-run')) return false;
  if (plan.action === 'exists') return false;
  if (options.flags.has('yes')) return true;
  if (options.flags.has('json')) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  const answer = await ask(`Write .screenslop/config.json for ${plan.config.defaultScheme || 'this app'} now? [y/N] `);
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

/**
 * Builds next-step commands for a ready setup plan.
 * @param {object} config Planned config.
 * @returns {string[]} Human/agent next commands.
 */
function setupReadyNext(config) {
  const surface = config?.defaultSurface || '<surface>';
  return [
    'screenslop doctor',
    `screenslop see --surface ${surface} --boot --json`,
    'screenslop critique artifacts/<run-id> --json'
  ];
}

/**
 * Builds selection guidance when setup cannot choose one target safely.
 * @param {object} choice Setup default choice result.
 * @returns {string[]} Suggested commands.
 */
function setupSelectionNext(choice) {
  const project = choice.detection.projects[0] || '<App.xcodeproj>';
  const workspace = choice.detection.workspaces[0] || '<App.xcworkspace>';
  const scheme = choice.detection.schemes[0] || '<Scheme>';
  const sourceRoot = choice.detection.sourceRoots[0] || '<SourceRoot>';
  const targetFlag = choice.detection.workspaces.length && !choice.detection.projects.length
    ? `--workspace ${workspace}`
    : `--project ${project}`;
  return [
    'screenslop setup --json --dry-run --project <App.xcodeproj> --scheme <Scheme> --bundle-id <bundle-id> --source-root <SourceRoot> --surface <surface>',
    'or: screenslop setup --json --dry-run --workspace <App.xcworkspace> --scheme <Scheme> --bundle-id <bundle-id> --source-root <SourceRoot> --surface <surface>',
    `example: screenslop setup --json --dry-run ${targetFlag} --scheme ${scheme} --bundle-id <bundle-id> --source-root ${sourceRoot} --surface <surface>`
  ];
}

/**
 * Prints setup output for humans or agents.
 * @param {object} result Setup result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printSetupResult(result, json) {
  const payload = redactSetupJson(result);
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!payload.ok) {
    console.error(`screenslop setup needs selection: ${payload.missing?.join(', ') || payload.error || payload.status}`);
    for (const command of payload.next || []) console.error(`- ${command}`);
    return;
  }

  console.log(`${payload.wrote ? 'Created' : 'Prepared'} .screenslop/config.json`);
  console.log(`Detection: ${payload.detection.status}`);
  console.log(`Project: ${payload.values.project || payload.values.workspace || '<missing>'}`);
  console.log(`Scheme: ${payload.values.scheme || '<missing>'}`);
  console.log(`Bundle ID: ${payload.values['bundle-id'] ? '<bundle-id>' : '<missing>'}`);
  console.log(`Source root: ${payload.values['source-root'] || '<missing>'}`);
  console.log('Next:');
  for (const command of payload.next || []) console.log(`- ${command}`);
}

/**
 * Redacts setup JSON fields that can expose private app details.
 * @param {object} payload Setup payload.
 * @returns {object} Redacted setup payload.
 */
function redactSetupJson(payload) {
  const redacted = redactInitJson({
    ...payload,
    config: redactSetupConfig(payload.config),
    detection: redactDetection(payload.detection),
    values: redactSetupValues(payload.values || {}),
    ambiguous: redactAmbiguous(payload.ambiguous || {}),
    next: redactSetupNext(payload.next || [])
  });
  if (redacted.config) redacted.config = redactSetupConfig(redacted.config);
  return redacted;
}

/**
 * Redacts project-identifying setup config fields in agent-facing JSON.
 * @param {object|null|undefined} config Config payload.
 * @returns {object|null|undefined} Redacted config.
 */
function redactSetupConfig(config) {
  if (!config) return config;
  return {
    ...config,
    defaultSurface: config.defaultSurface ? '<surface>' : config.defaultSurface,
    defaultScheme: config.defaultScheme ? '<scheme>' : config.defaultScheme,
    defaultBundleId: config.defaultBundleId ? '<bundle-id>' : config.defaultBundleId,
    defaultDevice: config.defaultDevice ? '<device>' : config.defaultDevice,
    workspacePath: config.workspacePath ? '<workspace>' : config.workspacePath,
    projectPath: config.projectPath ? '<project>' : config.projectPath,
    sourceRoot: config.sourceRoot ? '<source-root>' : config.sourceRoot,
    artifactsDir: config.artifactsDir ? '<artifacts-dir>' : config.artifactsDir
  };
}

/**
 * Redacts detection candidate values for agent-facing setup output.
 * @param {object} detection Detection payload.
 * @returns {object} Redacted detection payload.
 */
function redactDetection(detection) {
  if (!detection) return detection;
  return {
    ...detection,
    root: redactPath(detection.root),
    projects: (detection.projects || []).map(() => '<project>'),
    workspaces: (detection.workspaces || []).map(() => '<workspace>'),
    schemes: (detection.schemes || []).map(() => '<scheme>'),
    sourceRoots: (detection.sourceRoots || []).map(() => '<source-root>'),
    bundleIds: (detection.bundleIds || []).map(() => '<bundle-id>')
  };
}

/**
 * Redacts setup choice values.
 * @param {Record<string,string>} values Setup values.
 * @returns {Record<string,string>} Redacted values.
 */
function redactSetupValues(values) {
  return {
    ...values,
    surface: values.surface ? '<surface>' : values.surface,
    workspace: values.workspace ? '<workspace>' : values.workspace,
    project: values.project ? '<project>' : values.project,
    scheme: values.scheme ? '<scheme>' : values.scheme,
    device: values.device ? '<device>' : values.device,
    'source-root': values['source-root'] ? '<source-root>' : values['source-root'],
    'artifacts-dir': values['artifacts-dir'] ? '<artifacts-dir>' : values['artifacts-dir'],
    'bundle-id': values['bundle-id'] ? '<bundle-id>' : values['bundle-id']
  };
}

/**
 * Redacts suggested setup commands for agent-facing JSON.
 * @param {string[]} commands Suggested commands.
 * @returns {string[]} Redacted suggested commands.
 */
function redactSetupNext(commands) {
  return commands.map((command) => command
    .replace(/--surface\s+\S+/g, '--surface <surface>')
    .replace(/--scheme\s+\S+/g, '--scheme <Scheme>')
    .replace(/--project\s+\S+/g, '--project <App.xcodeproj>')
    .replace(/--workspace\s+\S+/g, '--workspace <App.xcworkspace>')
    .replace(/--source-root\s+\S+/g, '--source-root <SourceRoot>')
    .replace(/critique\s+\S+/g, 'critique artifacts/<run-id>'));
}

/**
 * Redacts ambiguous setup candidate values.
 * @param {Record<string,string[]>} ambiguous Ambiguity map.
 * @returns {Record<string,string[]>} Redacted ambiguity map.
 */
function redactAmbiguous(ambiguous) {
  return Object.fromEntries(Object.entries(ambiguous).map(([key, values]) => [
    key,
    values.map(() => redactSetupCandidate(key))
  ]));
}

/**
 * Returns the placeholder for an ambiguous setup candidate.
 * @param {string} key Ambiguity key.
 * @returns {string} Candidate placeholder.
 */
function redactSetupCandidate(key) {
  if (key === 'bundle-id') return '<bundle-id>';
  if (key === 'scheme') return '<scheme>';
  if (key === 'source-root') return '<source-root>';
  if (key === 'workspace') return '<workspace>';
  if (key === 'project') return '<project>';
  if (key === 'workspace-or-project') return '<project-or-workspace>';
  return '<candidate>';
}

/** Creates or migrates project config after explicit confirmation. */
async function initProject() {
  const options = parseOptions(args);
  if (options.flags.has('help') || options.flags.has('h')) {
    printInitHelp();
    return;
  }

  const values = await collectInitValues(options);
  const plan = planInitConfig({
    root: process.cwd(),
    detected: detectRuntimes(),
    values
  });

  try {
    if (!plan.ok) throw new Error(plan.error);

    const shouldWrite = await shouldWriteInitConfig(plan, options);
    if (shouldWrite) writeProjectConfig(process.cwd(), plan.config);

    const refusedMigration = plan.action === 'migrate' && !shouldWrite && !options.flags.has('dry-run');
    printInitResult({
      ...plan,
      ok: !refusedMigration,
      status: refusedMigration ? 'requires-migration-confirmation' : 'ready',
      dryRun: options.flags.has('dry-run'),
      wrote: shouldWrite
    }, options.flags.has('json'));

    if (refusedMigration) process.exitCode = 1;
  } catch (error) {
    if (options.flags.has('json')) {
      console.log(JSON.stringify(redactInitJson({
        ok: false,
        command: 'init',
        action: plan.action,
        status: 'failed',
        error: error.message,
        file: plan.file,
        config: plan.config || null
      }), null, 2));
    } else {
      console.error(`screenslop init failed: ${error.message}`);
      if (plan.action === 'migrate') {
        console.error('Re-run with --migrate --yes to rewrite the config, or --migrate --dry-run to inspect the new shape.');
      }
    }
    process.exitCode = 1;
  }
}

/** Prints init-specific options. */
function printInitHelp() {
  console.log(`Screenslop init

Usage:
  screenslop init [options]

Options:
  --json                 Print machine-readable output
  --dry-run              Show the config without writing files
  --migrate              Migrate an existing config shape
  --yes                  Skip interactive confirmation for writes
  --workspace <path>     Xcode workspace path
  --project <path>       Xcode project path
  --scheme <name>        Default scheme
  --bundle-id <id>       Default app bundle ID
  --device <name>        Default simulator device
  --source-root <path>   Source root for future apply flows
  --surface <name>       Default surface name for capture/report context
  --artifacts-dir <path> Artifact output directory
`);
}

/**
 * Collects init values from flags or an interactive terminal.
 * @param {{flags:Set<string>,values:Record<string,string>}} options Parsed options.
 * @returns {Promise<Record<string,string>>} Init values.
 */
async function collectInitValues(options) {
  const values = { ...options.values };
  if (options.flags.has('json') || options.flags.has('dry-run')) return values;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return values;

  const prompts = [
    ['workspace', 'Xcode workspace path (optional): '],
    ['project', 'Xcode project path (optional): '],
    ['scheme', 'Default scheme (optional): '],
    ['bundle-id', 'Default bundle ID (optional): '],
    ['device', 'Default simulator device (optional): '],
    ['source-root', 'Source root for fixes (optional, defaults later): '],
    ['artifacts-dir', 'Artifacts directory [artifacts]: ']
  ];

  for (const [key, prompt] of prompts) {
    if (values[key]) continue;
    const answer = (await ask(prompt)).trim();
    if (answer) values[key] = answer;
  }
  return values;
}

/**
 * Decides whether init should write the planned config.
 * @param {object} plan Init plan.
 * @param {{flags:Set<string>}} options Parsed options.
 * @returns {Promise<boolean>} True when writing is allowed.
 */
async function shouldWriteInitConfig(plan, options) {
  if (options.flags.has('dry-run')) return false;
  if (plan.action === 'exists') return false;
  if (plan.action === 'create') return options.flags.has('yes') || !options.flags.has('json');
  if (plan.action !== 'migrate') return false;

  if (!options.flags.has('migrate')) return false;
  if (options.flags.has('yes')) return true;
  if (options.flags.has('json')) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  const answer = await ask('Migrate existing .screenslop/config.json to schemaVersion: 1? [y/N] ');
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

/**
 * Prints init output for humans or agents.
 * @param {object} result Init result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printInitResult(result, json) {
  if (json) {
    console.log(JSON.stringify(redactInitJson({
      ok: result.ok,
      command: 'init',
      action: result.action,
      status: result.status || 'ready',
      file: path.relative(process.cwd(), result.file),
      wrote: result.wrote,
      dryRun: result.dryRun,
      schemaVersion: result.config?.schemaVersion || null,
      migration: result.migration,
      config: result.config
    }), null, 2));
    return;
  }

  if (result.action === 'exists') {
    console.log('.screenslop/config.json is already schemaVersion: 1. Leaving it alone.');
    return;
  }
  if (result.wrote) {
    console.log(`${result.action === 'migrate' ? 'Migrated' : 'Created'} .screenslop/config.json`);
    return;
  }
  console.log(`${result.action === 'migrate' ? 'Prepared migration for' : 'Prepared'} .screenslop/config.json`);
  if (result.action === 'migrate') console.log('Re-run with --migrate --yes to write it.');
}

/**
 * Redacts path-like init JSON values before agent-facing output.
 * @param {object} payload Init payload.
 * @returns {object} Redacted payload.
 */
function redactInitJson(payload) {
  const redacted = {
    ...payload,
    pathDisplayMode: 'redacted'
  };
  if (redacted.file) redacted.file = redactPath(redacted.file);
  if (redacted.config) redacted.config = redactConfig(redacted.config);
  if (redacted.migration?.config) {
    redacted.migration = {
      ...redacted.migration,
      config: redactConfig(redacted.migration.config)
    };
  }
  return redacted;
}

/**
 * Redacts private config fields for JSON output.
 * @param {object} config Config payload.
 * @returns {object} Redacted config.
 */
function redactConfig(config) {
  return {
    ...config,
    workspacePath: redactPath(config.workspacePath),
    projectPath: redactPath(config.projectPath),
    sourceRoot: redactPath(config.sourceRoot),
    artifactsDir: redactPath(config.artifactsDir),
    defaultBundleId: config.defaultBundleId ? '<bundle-id>' : config.defaultBundleId
  };
}

/**
 * Redacts absolute path prefixes in agent-facing output.
 * @param {string|null|undefined} value Path value.
 * @returns {string|null|undefined} Redacted value.
 */
function redactPath(value) {
  if (!value || typeof value !== 'string') return value;
  const root = process.cwd();
  const home = process.env.HOME || '';
  if (path.isAbsolute(value)) {
    const relative = path.relative(root, value);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return path.join('<repo>', relative);
    }
    if (home && (value === home || value.startsWith(`${home}${path.sep}`))) {
      return path.join('<home>', path.relative(home, value));
    }
    return '<absolute-path>';
  }
  return value;
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



/** Learns, checks, or refreshes the project-local design profile. */
async function learn() {
  const options = parseOptions(args);
  const wantsJson = options.flags.has('json');
  const wantsWrite = options.flags.has('write') && !options.flags.has('dry-run');

  try {
    const confirmed = wantsWrite && !options.flags.has('yes')
      ? await confirmDesignProfileWrite()
      : options.flags.has('yes');
    const result = collectDesignProfile({
      root: process.cwd(),
      profilePath: options.values['design-profile'] || options.values.profile || null,
      check: options.flags.has('check'),
      refresh: options.flags.has('refresh'),
      write: options.flags.has('write'),
      dryRun: options.flags.has('dry-run'),
      yes: options.flags.has('yes'),
      surface: options.values.surface || null,
      confirmed
    });
    printLearnResult(redactLearnResult(result), wantsJson);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    if (wantsJson) {
      console.log(JSON.stringify({ ok: false, command: 'learn', error: error.message }, null, 2));
    } else {
      console.error(`screenslop learn failed: ${error.message}`);
    }
    process.exitCode = 1;
  }
}

/** Asks before writing the private design profile. */
async function confirmDesignProfileWrite() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const answer = await ask('Write .screenslop/design-profile.json now? [y/N] ');
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

/**
 * Prints learn output for humans or agents.
 * @param {object} result Learn result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printLearnResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Design profile: ${result.profilePath || '<missing>'}`);
  console.log(`Status: ${result.status}`);
  console.log(`Action: ${result.action || 'learn'}`);
  console.log(`Wrote: ${result.wrote ? 'yes' : 'no'}`);
  if (result.sourceCount !== undefined) console.log(`Sources: ${result.sourceCount}`);
  for (const command of result.next || []) console.log(`Next: ${command}`);
}

/**
 * Redacts private path prefixes in learn output.
 * @param {object} result Learn result.
 * @returns {object} Redacted result.
 */
function redactLearnResult(result) {
  const redacted = { ...result, pathDisplayMode: 'redacted' };
  if (redacted.profilePath) redacted.profilePath = redactPath(redacted.profilePath);
  if (redacted.profile?.sources) {
    redacted.profile = {
      ...redacted.profile,
      sources: redacted.profile.sources.map((source) => ({ ...source, path: redactPath(source.path) }))
    };
  }
  if (redacted.freshness?.missingSources) {
    redacted.freshness = {
      ...redacted.freshness,
      missingSources: redacted.freshness.missingSources.map((sourcePath) => redactPath(sourcePath))
    };
  }
  return redacted;
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
    const sourceRoot = resolveFixSourceRoot(options, wantsApply);
    const confirmed = wantsApply && !options.flags.has('yes')
      ? await confirmApply()
      : options.flags.has('yes');

    const result = await collectFix({
      root: process.cwd(),
      bundlePath,
      sourceRoot,
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

/**
 * Resolves the source root allowed for fix planning/apply.
 * @param {{values:Record<string,string>}} options Parsed options.
 * @param {boolean} wantsApply Whether source edits may be applied.
 * @returns {string} Source root path.
 */
function resolveFixSourceRoot(options, wantsApply) {
  if (options.values['source-root']) {
    const config = createDefaultConfig({
      detected: { preferred: 'manual' },
      values: { 'source-root': options.values['source-root'], 'artifacts-dir': 'artifacts' }
    });
    return resolveTargetConfig(config, { root: process.cwd() }).sourceRoot;
  }

  const read = readProjectConfig(process.cwd());
  if (read.error) throw new Error(read.error);
  if (read.config?.sourceRoot) return resolveTargetConfig(read.config, { root: process.cwd() }).sourceRoot;
  if (wantsApply) throw new Error('screenslop fix --apply requires --source-root or .screenslop/config.json sourceRoot.');
  return process.cwd();
}


/** Compares baseline findings against a fresh evidence bundle. */
async function verify() {
  const options = parseOptions(args);
  const baselineBundle = firstPositional(args);
  const findingIds = optionList(options, 'finding');

  try {
    const result = await collectVerify({
      root: process.cwd(),
      baselineBundle,
      freshBundle: options.values['fresh-bundle'] || null,
      findingIds,
      refreshCritique: options.flags.has('refresh-critique'),
      fixSessionPath: options.values['fix-session'] || null
    });

    printVerifyResult(result, options.flags.has('json'));
  } catch (error) {
    if (options.flags.has('json')) {
      console.log(JSON.stringify({
        ok: false,
        command: 'verify',
        error: error.message
      }, null, 2));
    } else {
      console.error(`screenslop verify failed: ${error.message}`);
    }
    process.exitCode = 1;
  }
}


/** Reviews an evidence bundle and writes findings. */
async function critique() {
  const options = parseOptions(args);
  const bundlePath = firstPositional(args);

  try {
    let result = await collectCritique({
      root: process.cwd(),
      bundlePath
    });

    if (wantsDesignReview(options)) {
      result = collectDesignReview({
        root: process.cwd(),
        bundlePath,
        critiqueResult: result,
        profilePath: options.values['design-profile'] || null,
        agentPacket: options.flags.has('agent-packet'),
        importPath: options.values['import-design-findings'] || null
      });
    }

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
 * Checks whether critique should add the design-review layer.
 * @param {{flags:Set<string>,values:Record<string,string>}} options Parsed options.
 * @returns {boolean} True when design review is requested.
 */
function wantsDesignReview(options) {
  return options.flags.has('design') || options.flags.has('agent-packet') || Boolean(options.values['import-design-findings']);
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


/**
 * Prints verify output for humans or agents.
 * @param {object} result Verify result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printVerifyResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Verified baseline bundle: ${result.baselineBundle}`);
  console.log(`Fresh bundle: ${result.freshBundle}`);
  console.log(`Items: ${result.summary.total}`);
  console.log(`verified-fixed: ${result.summary.verifiedFixed}`);
  console.log(`still-present: ${result.summary.stillPresent}`);
  console.log(`changed: ${result.summary.changed}`);
  console.log(`unknown: ${result.summary.unknown}`);
  console.log(`verification: ${result.artifacts.verificationPath}`);
  console.log(`report: ${result.artifacts.reportPath}`);

  for (const item of result.items.slice(0, 8)) {
    console.log(`- ${item.findingId}: ${item.status} — ${item.reason}`);
  }
  if (result.items.length > 8) console.log(`...${result.items.length - 8} more item(s)`);
}

/**
 * Prints matrix output for humans or agents.
 * @param {object} result Matrix result.
 * @param {boolean} json Whether to print strict JSON.
 * @returns {void}
 */
function printMatrixResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Matrix report: ${result.artifacts.reportPath}`);
  console.log(`Cells: ${result.summary.total}`);
  console.log(`captured: ${result.summary.captured}`);
  console.log(`dry-run: ${result.summary.dryRun}`);
  console.log(`unavailable: ${result.summary.unavailable}`);
  console.log(`failed: ${result.summary.failed}`);

  for (const cell of result.cells) {
    const note = cell.reason ? ` (${cell.reason})` : '';
    console.log(`- ${cell.id}: ${cell.status}${note}`);
  }
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
  const booleanFlags = new Set(['apply', 'boot', 'agent-packet', 'check', 'critique', 'design', 'dry-run', 'help', 'h', 'install-baguette', 'json', 'logs', 'refresh', 'refresh-critique', 'write', 'yes']);

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
  const booleanFlags = new Set(['apply', 'boot', 'agent-packet', 'check', 'critique', 'design', 'dry-run', 'help', 'h', 'install-baguette', 'json', 'logs', 'refresh', 'refresh-critique', 'write', 'yes']);
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
