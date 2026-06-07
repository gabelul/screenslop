import { hasCommand, run } from './shell.mjs';

/**
 * Detects runtime tools Screenslop can use on this machine.
 * @returns {object} Runtime availability and version hints.
 */
export function detectRuntimes() {
  const tools = {
    baguette: detectCommand('baguette', 'baguette --version 2>/dev/null || baguette list --help 2>/dev/null | head -1'),
    xcodebuildmcp: detectCommand('xcodebuildmcp', 'xcodebuildmcp --version 2>/dev/null || xcodebuildmcp --help | head -1'),
    xcodebuild: detectCommand('xcodebuild', 'xcodebuild -version'),
    simctl: detectCommand('xcrun', 'xcrun simctl help | head -1'),
    swift: detectCommand('swift', 'swift --version | head -1'),
    node: detectCommand('node', 'node --version')
  };

  const preferred = tools.baguette.available
    ? 'baguette'
    : tools.xcodebuildmcp.available
      ? 'xcodebuildmcp'
      : tools.xcodebuild.available && tools.simctl.available
        ? 'simctl'
        : 'manual';

  return { preferred, tools };
}

/**
 * Detects a command and optionally captures a short version string.
 * @param {string} command Command to look up on PATH.
 * @param {string} versionCommand Command used to get version/help output.
 * @returns {{available:boolean, version:string|null}}
 */
function detectCommand(command, versionCommand) {
  const available = hasCommand(command);
  if (!available) return { available, version: null };

  const result = run(versionCommand);
  const version = (result.stdout || result.stderr).trim().split('\n')[0] || null;
  return { available, version };
}
