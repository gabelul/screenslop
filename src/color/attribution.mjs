// Color attribution: work out which brand token a rendered color came from.
//
// Matching sampled pixels against raw token hexes by RGB distance fails the
// moment an app renders a derived variant, which is most of the time. Measured
// on a real device: a warning token #D4A441 rendered as #8A6410, and a success
// token #A7B89A rendered as #5B6B4F. Euclidean RGB puts those 109 and 132 apart
// — past any sane "unknown color" cutoff — while their hues moved 1.5 and 0.5
// degrees. The app darkened them for legibility; it did not abandon the palette.
//
// So hue and chroma identify the *family*, and lightness carries the change.
// Hue is a candidate gate, not a verdict: two tokens in one hue family can both
// explain a sample, and when they do this reports ambiguity rather than picking
// a winner it cannot justify.
//
// Work happens in OKLCh rather than HSL. HSL saturation is entangled with
// lightness, so a near-black pixel can report healthy saturation while its
// channels barely differ — exactly the case where hue is noise. OKLCh chroma
// gives an honest floor. The conversion is fixed math with no dependency.

// Below this chroma the color is a gray, off-white, or tinted neutral, and its
// hue is numerically unstable. iOS UI is full of these, so this path is common.
const neutralChromaFloor = 0.03;
// Measured hue drift on real derived variants was 1.5 degrees at worst. Six
// leaves 4x headroom without opening the gate to a neighbouring hue family.
const hueGateDegrees = 6;
// A derived variant may be muted or intensified; beyond a factor of two it is a
// different decision, not the same token rendered differently.
const chromaRatioMin = 0.5;
const chromaRatioMax = 2;
// The winner must beat the runner-up by this much, or both get reported.
const ambiguityMargin = 0.25;
// Distance at which a sample is the raw token as far as a lossy capture can
// tell. Matches the existing token-drift band so the two agree on "on token".
// This is codec tolerance, not equality — `exact` is reserved for equality,
// because calling #F4F4F5 an exact rendering of #FCFDFC is simply untrue.
const directRgbDistance = 20;
// An opacity blend needs to contribute real color; below this alpha the sample
// is mostly background and any token would "fit".
const minOpacityAlpha = 0.15;
// Per-channel RMS residual (0-255) accepted when testing a blend hypothesis.
const opacityResidualTolerance = 4;

/**
 * Converts an sRGB pixel to OKLCh.
 * @param {{r:number,g:number,b:number}} pixel Channels 0-255.
 * @returns {{L:number,C:number,h:number}} Lightness 0-1, chroma, hue in degrees.
 */
export function srgbToOklch(pixel) {
  const linear = (value) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(pixel.r);
  const g = linear(pixel.g);
  const b = linear(pixel.b);

  // Ottosson's OKLab matrices.
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const C = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/**
 * Attributes a sampled color to the token it most likely came from.
 *
 * @param {{r:number,g:number,b:number}} sampled Representative rendered color.
 * @param {{name:string,r:number,g:number,b:number,hex:string}[]} tokens Profile color tokens.
 * @returns {{status:string, token:object|null, candidates:object[], lightnessDelta:number|null, confidence:string}}
 */
export function attributeColor(sampled, tokens = [], options = {}) {
  const usable = tokens.filter(isValidColor);
  if (!isValidColor(sampled) || usable.length === 0) {
    return { status: 'unknown', token: null, candidates: [], lightnessDelta: null, confidence: 'low' };
  }
  const background = isValidColor(options.background) ? options.background : null;

  // Everything inside the codec-tolerance band is a candidate, not just the
  // closest one. Picking the nearest and calling it high confidence let array
  // order decide the answer whenever two tokens sat in the band together.
  const inBand = usable
    .map((token) => ({ token, distance: rgbDistance(sampled, token) }))
    .filter((entry) => entry.distance <= directRgbDistance)
    .sort((left, right) => left.distance - right.distance);

  if (inBand.length > 0) {
    const equal = inBand.filter((entry) => entry.distance === 0);
    const winner = equal.length === 1 ? equal[0].token : (inBand.length === 1 ? inBand[0].token : null);

    // Landing on a token does not mean it was the token used. A different token
    // drawn at partial opacity over this background can land exactly there, and
    // returning before checking that made the most confident answer the wrong
    // one. The blend test has to gate every path that names a token, not just
    // the derived one.
    const blendRivals = winner ? blendExplanations(sampled, background, usable, winner) : [];
    if (winner && blendRivals.length === 0) {
      return equal.length === 1
        ? { status: 'exact', token: winner, candidates: [winner], lightnessDelta: 0, confidence: 'high' }
        : { status: 'close', token: winner, candidates: [winner], lightnessDelta: 0, confidence: 'medium' };
    }

    return {
      status: 'ambiguous',
      token: null,
      candidates: winner ? [winner, ...blendRivals] : inBand.map((entry) => entry.token),
      lightnessDelta: 0,
      confidence: 'low'
    };
  }

  const sample = srgbToOklch(sampled);
  if (sample.C < neutralChromaFloor) {
    // Hue is meaningless here. Say so rather than naming a token on noise.
    return { status: 'neutral', token: null, candidates: [], lightnessDelta: null, confidence: 'low' };
  }

  const candidates = [];
  for (const token of usable) {
    const tokenColor = srgbToOklch(token);
    if (tokenColor.C < neutralChromaFloor) continue;
    const hueDelta = hueDistance(sample.h, tokenColor.h);
    if (hueDelta > hueGateDegrees) continue;
    const chromaRatio = sample.C / tokenColor.C;
    if (chromaRatio < chromaRatioMin || chromaRatio > chromaRatioMax) continue;
    candidates.push({
      token,
      hueDelta,
      chromaRatio,
      lightnessDelta: sample.L - tokenColor.L,
      score: Math.sqrt((hueDelta / hueGateDegrees) ** 2 + Math.log2(chromaRatio) ** 2)
    });
  }

  if (candidates.length === 0) {
    return { status: 'unknown', token: null, candidates: [], lightnessDelta: null, confidence: 'low' };
  }

  candidates.sort((left, right) => left.score - right.score);
  const best = candidates[0];
  const runnerUp = candidates[1];

  // Two tokens in one hue family can both explain a darkened sample. Naming one
  // would be a guess dressed as evidence.
  if (runnerUp && runnerUp.score - best.score < ambiguityMargin) {
    return {
      status: 'ambiguous',
      token: null,
      candidates: candidates.map((entry) => entry.token),
      lightnessDelta: best.lightnessDelta,
      confidence: 'low'
    };
  }

  // Hue survives opacity, so a token blended over the background can look like
  // a derived variant of a different token.
  const blendRivals = blendExplanations(sampled, background, usable, best.token);
  if (blendRivals.length > 0) {
    return {
      status: 'ambiguous',
      token: null,
      candidates: [best.token, ...blendRivals],
      lightnessDelta: best.lightnessDelta,
      confidence: 'low'
    };
  }

  return {
    status: 'derived',
    token: best.token,
    candidates: candidates.map((entry) => entry.token),
    lightnessDelta: best.lightnessDelta,
    confidence: 'medium'
  };
}

/**
 * Finds tokens other than the winner that explain the sample as an opacity blend.
 * @param {{r:number,g:number,b:number}} sampled Observed color.
 * @param {{r:number,g:number,b:number}|null} background Measured background, when known.
 * @param {object[]} tokens Candidate tokens.
 * @param {object} winner Token the primary path selected.
 * @returns {object[]} Rival tokens a blend would also explain.
 */
function blendExplanations(sampled, background, tokens, winner) {
  if (!background) return [];
  return tokens.filter((token) => {
    if (token === winner) return false;
    if (!fitsAsBlend(sampled, background, token)) return false;
    // On the neutral axis a blend hypothesis is vacuous: every gray lies
    // between black and white, so "black at 60% over white explains #AAAAAA"
    // is arithmetic, not evidence. Requiring one of the three to carry real
    // chroma keeps the check meaningful instead of making every piece of gray
    // text ambiguous — which is most text in most apps.
    const allNeutral = [sampled, background, token]
      .every((color) => srgbToOklch(color).C < neutralChromaFloor);
    return !allNeutral;
  });
}

/**
 * Tests whether a sample could be a token drawn at partial opacity over a background.
 *
 * Solves for the alpha that best explains the sample in linear light, then
 * checks the residual. Alpha below the floor is rejected: a nearly transparent
 * layer leaves the background almost untouched, so every token "fits".
 *
 * @param {{r:number,g:number,b:number}} sampled Observed color.
 * @param {{r:number,g:number,b:number}} background Measured background color.
 * @param {{r:number,g:number,b:number}} token Candidate token.
 * @returns {boolean} Whether a plausible blend explains the sample.
 */
function fitsAsBlend(sampled, background, token) {
  const channels = ['r', 'g', 'b'];
  let numerator = 0;
  let denominator = 0;
  for (const channel of channels) {
    const delta = linearChannel(token[channel]) - linearChannel(background[channel]);
    numerator += (linearChannel(sampled[channel]) - linearChannel(background[channel])) * delta;
    denominator += delta * delta;
  }
  if (denominator === 0) return false;

  const alpha = numerator / denominator;
  if (!(alpha >= minOpacityAlpha) || alpha > 1) return false;

  // Composite in linear light, then convert back so the residual is expressed
  // in the same 0-255 units as the tolerance. Solving in one space and scoring
  // in another silently never fits.
  let squaredError = 0;
  for (const channel of channels) {
    const predictedLinear = alpha * linearChannel(token[channel]) + (1 - alpha) * linearChannel(background[channel]);
    squaredError += (srgbChannel(predictedLinear) - sampled[channel]) ** 2;
  }
  return Math.sqrt(squaredError / channels.length) <= opacityResidualTolerance;
}

/**
 * Converts a linear-light value back to an sRGB channel.
 * @param {number} value Linear value 0-1.
 * @returns {number} Channel 0-255.
 */
function srgbChannel(value) {
  const clamped = Math.min(1, Math.max(0, value));
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

/**
 * Converts one sRGB channel to linear light.
 * @param {number} value Channel 0-255.
 * @returns {number} Linear value 0-1.
 */
function linearChannel(value) {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/**
 * Rejects colors whose channels are missing, non-finite, or out of range.
 * Unvalidated NaN propagated all the way to a confident attribution with a
 * non-finite lightness delta.
 * @param {object|null} color Candidate color.
 * @returns {boolean} Whether every channel is a real 0-255 value.
 */
function isValidColor(color) {
  if (!color || typeof color !== 'object') return false;
  return ['r', 'g', 'b'].every((channel) => {
    const value = color[channel];
    return Number.isFinite(value) && value >= 0 && value <= 255;
  });
}

/**
 * Describes an attribution result for a finding.
 * @param {object} result Attribution result.
 * @returns {string} Human-readable attribution, empty when nothing can be said.
 */
export function describeAttribution(result) {
  if (!result || result.status === 'unknown') return '';
  if (result.status === 'neutral') return ' The sampled color is a near-neutral, so it cannot be traced to a color token.';
  if (result.status === 'exact') return ` This is your \`${result.token.name}\` token (${result.token.hex}) rendered directly.`;
  if (result.status === 'close') return ` This matches your \`${result.token.name}\` token (${result.token.hex}) to within capture noise.`;
  if (result.status === 'ambiguous') {
    const names = result.candidates.map((token) => `\`${token.name}\``).join(' or ');
    return ` The sampled color looks like a derived variant of ${names}, but the evidence cannot separate them.`;
  }
  const points = Math.round(result.lightnessDelta * 100);
  const direction = points < 0 ? 'darker' : 'lighter';
  return ` This looks like your \`${result.token.name}\` token (${result.token.hex}) rendered ${Math.abs(points)} OKLCh lightness points ${direction}.`;
}

/**
 * Euclidean RGB distance.
 * @param {{r:number,g:number,b:number}} a First color.
 * @param {{r:number,g:number,b:number}} b Second color.
 * @returns {number} Distance.
 */
function rgbDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Shortest angular distance between two hues.
 * @param {number} a First hue in degrees.
 * @param {number} b Second hue in degrees.
 * @returns {number} Distance in degrees, 0-180.
 */
function hueDistance(a, b) {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}
