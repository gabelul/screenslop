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
