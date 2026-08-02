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
    const exact = devices.find((candidate) => normalize(candidate.name) === deviceName);
    if (exact) return { device: exact, reason: null, devices };

    const partial = devices.find((candidate) => normalize(candidate.name).includes(deviceName));
    return { device: partial || null, reason: partial ? null : 'device-not-found', devices };
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
    notes.push(`Config targets "${configuredName}" but no simulator matched it. Falling back to the booted simulator.`);
    return { device: auto.device, source: autoSource(auto), reason: auto.reason, notes, devices: auto.devices };
  }

  if (auto.device && auto.device.udid !== configured.device.udid && isBooted(auto.device)) {
    notes.push(`${auto.device.name} is booted but config targets "${configuredName}". Using the configured device.`);
  }

  return { device: configured.device, source: 'config', reason: null, notes, devices: configured.devices };
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
