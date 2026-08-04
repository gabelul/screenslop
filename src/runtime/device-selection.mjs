/**
 * Flattens Baguette's simulator envelope into one list.
 * @param {object|null} envelope Parsed `baguette list --json` output.
 * @returns {Array<object>} Devices with source buckets attached.
 */
export function flattenBaguetteDevices(envelope) {
  if (!envelope || typeof envelope !== 'object') return [];
  const running = Array.isArray(envelope.running) ? envelope.running : [];
  const available = Array.isArray(envelope.available) ? envelope.available : [];

  return [
    ...running.map((device) => ({ ...device, bucket: 'running' })),
    ...available.map((device) => ({ ...device, bucket: 'available' }))
  ];
}

/**
 * Picks the simulator Screenslop should capture from.
 * @param {object|null} envelope Parsed `baguette list --json` output.
 * @param {object} [options] Selection options.
 * @param {string|null} [options.udid] Exact simulator UDID.
 * @param {string|null} [options.deviceName] Exact or partial simulator name.
 * @returns {{device:object|null, reason:string|null, devices:Array<object>}}
 */
export function selectBaguetteDevice(envelope, options = {}) {
  const devices = flattenBaguetteDevices(envelope);
  const udid = normalize(options.udid);
  const deviceName = normalize(options.deviceName);

  if (udid) {
    const device = devices.find((candidate) => normalize(candidate.udid) === udid);
    return { device: device || null, reason: device ? null : 'udid-not-found', devices };
  }

  if (deviceName) {
    // Duplicate simulator names across installed runtimes are normal — two
    // "iPhone 17 Pro" devices on iOS 26.4 and 26.5 is a stock setup. Taking the
    // first match silently captured from whichever the list happened to order
    // first, so ambiguity is an error rather than a coin flip.
    const exact = devices.filter((candidate) => normalize(candidate.name) === deviceName);
    if (exact.length === 1) return { device: exact[0], reason: null, devices };
    if (exact.length > 1) return { device: null, reason: 'device-name-ambiguous', matches: exact, devices };

    const partial = devices.filter((candidate) => normalize(candidate.name).includes(deviceName));
    if (partial.length === 1) return { device: partial[0], reason: null, devices };
    if (partial.length > 1) return { device: null, reason: 'device-name-ambiguous', matches: partial, devices };
    return { device: null, reason: 'device-not-found', devices };
  }

  const running = devices.find((candidate) => candidate.state === 'Booted' || candidate.bucket === 'running');
  if (running) return { device: running, reason: null, devices };

  return {
    device: devices[0] || null,
    reason: devices[0] ? 'no-running-device' : 'no-devices',
    devices
  };
}

/**
 * Resolves the capture target across the full precedence cascade.
 *
 * Precedence, highest first: `--udid`, `--device`, config `defaultDevice`,
 * the booted simulator, then the first available one. Config beats a booted
 * simulator on purpose — otherwise a stray sim left running quietly hijacks
 * the capture and you get an evidence bundle for the wrong app.
 *
 * Explicit flags are strict: naming a device that does not exist is an error,
 * because you asked for that one specifically. A config miss is forgiving —
 * it warns and falls back, so a deleted simulator doesn't brick every capture.
 *
 * @param {object|null} envelope Parsed `baguette list --json` output.
 * @param {object} [options] Selection options.
 * @param {string|null} [options.udid] Exact simulator UDID from `--udid`.
 * @param {string|null} [options.deviceName] Simulator name from `--device`.
 * @param {string|null} [options.configuredDeviceName] Config `defaultDevice`.
 * @returns {{device:object|null, source:string, reason:string|null, notes:string[], devices:Array<object>}}
 */
export function resolveCaptureDevice(envelope, options = {}) {
  const udid = normalize(options.udid);
  const deviceName = normalize(options.deviceName);
  const configuredName = String(options.configuredDeviceName || '').trim();
  const notes = [];

  if (udid || deviceName) {
    const selection = selectBaguetteDevice(envelope, { udid: options.udid, deviceName: options.deviceName });
    if (selection.reason === 'device-name-ambiguous') {
      notes.push(ambiguityNote(options.deviceName, selection.matches));
    }
    return {
      device: selection.device,
      source: udid ? 'udid-flag' : 'device-flag',
      reason: selection.reason,
      notes,
      devices: selection.devices
    };
  }

  const auto = selectBaguetteDevice(envelope);

  if (!configuredName) {
    return { device: auto.device, source: autoSource(auto), reason: auto.reason, notes, devices: auto.devices };
  }

  const configured = selectBaguetteDevice(envelope, { deviceName: configuredName });

  if (!configured.device) {
    // Describe where the fallback actually landed. Claiming "falling back to
    // the booted simulator" while returning a shut-down iPad was a lie the
    // reader had no way to catch.
    const source = autoSource(auto);
    const landing = {
      booted: 'Falling back to the booted simulator.',
      'first-available': 'No simulator is booted, so falling back to the first available one.',
      none: 'No simulator is available to fall back to.'
    }[source];
    const why = configured.reason === 'device-name-ambiguous'
      ? ambiguityNote(configuredName, configured.matches)
      : `Config targets "${configuredName}" but no simulator matched it.`;
    notes.push(`${why} ${landing}`);
    return { device: auto.device, source, reason: auto.reason, notes, devices: auto.devices };
  }

  if (auto.device && auto.device.udid !== configured.device.udid && isBooted(auto.device)) {
    notes.push(`${auto.device.name} is booted but config targets "${configuredName}". Using the configured device.`);
  }

  return { device: configured.device, source: 'config', reason: null, notes, devices: configured.devices };
}

/**
 * Describes an ambiguous name match, naming the runtimes that collided.
 * @param {string} requested Requested device name.
 * @param {Array<object>} matches Devices that matched.
 * @returns {string} Note text.
 */
function ambiguityNote(requested, matches = []) {
  const described = matches
    .map((device) => `${device.name}${device.runtime ? ` (${device.runtime})` : ''}`)
    .join(', ');
  return `"${requested}" matches ${matches.length} simulators — ${described}. Pass --udid to say which one.`;
}

/**
 * Labels how an unhinted selection landed on its device.
 * @param {{device:object|null, reason:string|null}} selection Raw selection result.
 * @returns {string} Selection source label.
 */
function autoSource(selection) {
  if (!selection.device) return 'none';
  return selection.reason === 'no-running-device' ? 'first-available' : 'booted';
}

/**
 * Checks whether a simulator is already booted.
 * @param {object|null} device Simulator record.
 * @returns {boolean} True when Baguette reports a booted device.
 */
export function isBooted(device) {
  return Boolean(device && (device.state === 'Booted' || device.bucket === 'running'));
}

/**
 * Normalizes user and simulator identifiers for matching.
 * @param {string|undefined|null} value Text to normalize.
 * @returns {string} Lowercase trimmed value.
 */
function normalize(value) {
  return String(value || '').trim().toLowerCase();
}
