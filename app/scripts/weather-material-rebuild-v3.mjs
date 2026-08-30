import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Final static material recovery.
 *
 * Geometry authority is always one of the three approved pre-V2 Sunny
 * masters. Non-Sunny imagery contributes only a deliberately low-frequency
 * weather/material field. There is no edge guard, sharpening, high-pass
 * preservation or repeated processing from V1/V2.
 */
const prototypeRoot = path.resolve('assets', 'home', 'prototypes');
const outputRoot = path.join(prototypeRoot, 'weather-material-rebuild-v3');
const referenceRoot = path.join(outputRoot, 'material-references');
const skySource = path.join(referenceRoot, 'natural-nz-night-sky-reference.png');
const dayMaterialSource = path.join(referenceRoot, 'sunny-day-natural-material-reference.png');

const geometryMasters = {
  day: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-day-final-micro-native.png'),
  sunset: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-evening-final-micro-native.png'),
  night: path.join(prototypeRoot, 'deep-night-exploration', 'deep-night-starlight-native.png'),
};

const weatherReferences = {
  cloudy: {
    day: path.join(prototypeRoot, 'weather-full-frame-correction', 'cloudy', 'cloudy-day-full-frame-native.png'),
    sunset: path.join(prototypeRoot, 'weather-full-frame-correction', 'cloudy', 'cloudy-sunset-full-frame-native.png'),
    night: path.join(prototypeRoot, 'weather-full-frame-correction', 'cloudy', 'cloudy-night-full-frame-native.png'),
  },
  rainy: {
    day: path.join(prototypeRoot, 'weather-full-frame-correction', 'rainy', 'rainy-day-full-frame-native.png'),
    sunset: path.join(prototypeRoot, 'weather-full-frame-correction', 'rainy', 'rainy-sunset-full-frame-native.png'),
    night: path.join(prototypeRoot, 'weather-full-frame-correction', 'rainy', 'rainy-night-full-frame-native.png'),
  },
  snowy: {
    day: path.join(prototypeRoot, 'weather-full-frame-correction', 'snowy', 'snowy-day-full-frame-native.png'),
    sunset: path.join(prototypeRoot, 'weather-full-frame-correction', 'snowy', 'snowy-sunset-full-frame-native.png'),
    night: path.join(prototypeRoot, 'weather-full-frame-correction', 'snowy', 'snowy-night-full-frame-native.png'),
  },
};

const states = [
  ['sunny', 'day'], ['sunny', 'sunset'], ['sunny', 'night'],
  ['cloudy', 'day'], ['cloudy', 'sunset'], ['cloudy', 'night'],
  ['rainy', 'day'], ['rainy', 'sunset'], ['rainy', 'night'],
  ['snowy', 'day'], ['snowy', 'sunset'], ['snowy', 'night'],
];

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function stableNoise(x, y, seed = 0) {
  let value = Math.imul(x + 31 + seed, 374761393) ^ Math.imul(y + 47 + seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function skylineAt(x) {
  if (x < 0.255) return 0.285;
  if (x < 0.58) return 0.34 + ((x - 0.255) / 0.325) * 0.12;
  return 0.46 - ((x - 0.58) / 0.42) * 0.18;
}

function waterWeight(x, y) {
  if (x < 0.39 || y < 0.47 || y > 0.625) return 0;
  const left = smoothstep(0.39, 0.50, x);
  const top = 0.487 + Math.max(0, x - 0.48) * 0.008;
  const bottom = 0.516 + Math.max(0, x - 0.39) * 0.13;
  return left * smoothstep(top, top + 0.014, y) * (1 - smoothstep(bottom - 0.024, bottom, y));
}

function materialSoftness(x, y) {
  const skyline = skylineAt(x);
  const distant = smoothstep(skyline + 0.006, skyline + 0.035, y) * (1 - smoothstep(0.49, 0.56, y));
  const mid = smoothstep(0.47, 0.58, y) * (1 - smoothstep(0.66, 0.76, y));
  const foreground = smoothstep(0.60, 0.78, y);
  // Distant simplification is strongest. Foreground retains readable trail
  // detail while losing embossed micro-contrast.
  return Math.max(distant * 0.70, mid * 0.57, foreground * 0.43);
}

async function rawVariant(file, width, height, transform = image => image) {
  return transform(sharp(file).resize(width, height, { fit: 'fill' }).removeAlpha()).raw().toBuffer();
}

async function buildState(family, time) {
  const key = `${family}-${time}`;
  const geometryPath = geometryMasters[time];
  const geometry = sharp(geometryPath).resize(853, 1844, { fit: 'fill' }).removeAlpha();
  const { width = 853, height = 1844 } = await geometry.metadata();
  const original = await geometry.clone().raw().toBuffer();
  const organic = await geometry.clone().median(3).blur(0.9).raw().toBuffer();
  const broad = await geometry.clone().blur(5.5).raw().toBuffer();
  const waterOrganic = await geometry.clone().median(5).blur(1.55).raw().toBuffer();
  const output = Buffer.from(original);

  let weatherNatural = null;
  let weatherBroad = null;
  if (family !== 'sunny') {
    const weatherPath = weatherReferences[family][time];
    weatherNatural = await rawVariant(weatherPath, width, height, image => image.median(5).blur(1.05));
    weatherBroad = await rawVariant(weatherPath, width, height, image => image.blur(6.5));
  }

  let dayMaterial = null;
  if (time === 'day' && fs.existsSync(dayMaterialSource)) {
    dayMaterial = await rawVariant(dayMaterialSource, width, height, image => image.median(3).blur(0.55));
  }

  for (let y = 0; y < height; y += 1) {
    const yn = y / height;
    for (let x = 0; x < width; x += 1) {
      const xn = x / width;
      const i = (y * width + x) * 3;
      const material = materialSoftness(xn, yn);
      const water = waterWeight(xn, yn);

      for (let c = 0; c < 3; c += 1) {
        // Start from the clean geometry master and remove medium/high-frequency
        // synthetic texture unconditionally inside material regions.
        let value = original[i + c] + (organic[i + c] - original[i + c]) * material;

        if (family !== 'sunny') {
          const weatherStrength = family === 'snowy' ? 0.68 : family === 'rainy' ? 0.84 : 0.72;
          const lowFrequencyDelta = weatherBroad[i + c] - broad[i + c];
          value += lowFrequencyDelta * weatherStrength;
          // A smaller soft material contribution carries snow coverage,
          // wetness and diffuse vegetation response without carrying facets.
          const materialCarry = family === 'snowy' ? 0.18 : family === 'rainy' ? 0.24 : 0.19;
          value += (weatherNatural[i + c] - (original[i + c] + lowFrequencyDelta)) * materialCarry;
          const sky = 1 - smoothstep(skylineAt(xn) - 0.018, skylineAt(xn) + 0.015, yn);
          const directWeather = sky * (family === 'rainy' ? 0.76 : family === 'cloudy' ? 0.66 : 0.58)
            + (1 - sky) * (family === 'rainy' ? 0.12 : family === 'cloudy' ? 0.10 : 0.16);
          value += (weatherNatural[i + c] - value) * directWeather;
        } else if (dayMaterial) {
          // Generated pixels are material reference only; geometry remains
          // dominated by the locked raster (82–94% depending on region).
          const refMix = Math.max(water * 0.18, material * 0.08);
          value += (dayMaterial[i + c] - value) * refMix;
        }

        if (water > 0) {
          // Replace—not preserve—the crystalline edge network. A very small
          // source contribution keeps occasional real sparkle without shards.
          const reconstructed = waterOrganic[i + c] * 0.88 + broad[i + c] * 0.12;
          const waterMix = family === 'rainy' ? 0.90 : family === 'cloudy' ? 0.88 : 0.86;
          value += (reconstructed - value) * water * waterMix;
        }

        output[i + c] = clamp(value);
      }
    }
  }

  if (family === 'rainy') {
    // Sparse depth-aware rainfall: far marks are short and faint, mid marks
    // remain readable against terrain, and near marks are longer but rare.
    // Placement, length and luminance vary with local background, avoiding a
    // uniform screen-overlay curtain.
    const bands = [
      { y0: 0.28, y1: 0.54, step: 17, length: 3, alpha: 0.09, seed: 13 },
      { y0: 0.48, y1: 0.76, step: 23, length: 6, alpha: 0.13, seed: 29 },
      { y0: 0.66, y1: 0.98, step: 31, length: 10, alpha: 0.16, seed: 47 },
    ];
    for (const band of bands) {
      const startY = Math.floor(height * band.y0);
      const endY = Math.floor(height * band.y1);
      for (let gy = startY; gy < endY; gy += band.step) {
        for (let gx = 4; gx < width - 4; gx += band.step) {
          if (stableNoise(gx, gy, band.seed) > 0.19) continue;
          const ox = Math.floor((stableNoise(gx, gy, band.seed + 1) - 0.5) * band.step);
          const oy = Math.floor((stableNoise(gx, gy, band.seed + 2) - 0.5) * band.step);
          const length = Math.max(2, Math.round(band.length * (0.75 + stableNoise(gx, gy, band.seed + 3) * 0.5)));
          for (let n = 0; n < length; n += 1) {
            const px = gx + ox - Math.floor(n * 0.28);
            const py = gy + oy + n;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;
            const i = (py * width + px) * 3;
            const lum = output[i] * 0.2126 + output[i + 1] * 0.7152 + output[i + 2] * 0.0722;
            const target = lum > 150 ? lum - 18 : lum + 34;
            const taper = Math.sin(((n + 1) / (length + 1)) * Math.PI);
            const alpha = band.alpha * taper;
            output[i] = clamp(output[i] + (target * 0.86 - output[i]) * alpha);
            output[i + 1] = clamp(output[i + 1] + (target * 0.94 - output[i + 1]) * alpha);
            output[i + 2] = clamp(output[i + 2] + (target - output[i + 2]) * alpha);
          }
        }
      }
    }
  }

  // Continuous night-sky integration. The entire low-frequency field and
  // faint-star population is blended; no peak extraction or dot placement.
  if ((key === 'sunny-night' || key === 'snowy-night') && fs.existsSync(skySource)) {
    const sky = await rawVariant(skySource, width, height, image => image.blur(0.3));
    for (let y = 0; y < Math.round(height * 0.48); y += 1) {
      const yn = y / height;
      for (let x = 0; x < width; x += 1) {
        const xn = x / width;
        const skyline = skylineAt(xn);
        const horizonFade = 1 - smoothstep(skyline - 0.045, skyline + 0.002, yn);
        if (horizonFade <= 0) continue;
        const heroQuiet = xn < 0.69 && yn > 0.075 ? 0.70 : 1;
        const baseStrength = key === 'snowy-night' ? 0.38 : 0.44;
        const strength = baseStrength * horizonFade * heroQuiet;
        const i = (y * width + x) * 3;
        for (let c = 0; c < 3; c += 1) {
          let skyValue = sky[i + c];
          if (key === 'snowy-night') {
            if (c === 0) skyValue *= 0.92;
            if (c === 2) skyValue = Math.min(255, skyValue * 1.06);
          }
          output[i + c] = clamp(output[i + c] + (skyValue - output[i + c]) * strength);
        }
      }
    }
  }

  const familyDir = path.join(outputRoot, family);
  fs.mkdirSync(familyDir, { recursive: true });
  const nativePath = path.join(familyDir, `${key}-soft-natural-v3-native.png`);
  const runtimePath = path.join(familyDir, `${key}-soft-natural-v3-3x.jpg`);
  const pipeline = sharp(output, { raw: { width, height, channels: 3 } });
  await pipeline.clone().png({ compressionLevel: 9 }).toFile(nativePath);
  await pipeline.clone().resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 93, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(runtimePath);
  return {
    key,
    geometryMaster: geometryPath,
    weatherReference: family === 'sunny' ? null : weatherReferences[family][time],
    nativePath,
    runtimePath,
    dimensions: `${width}x${height}`,
    rejectedV2UsedAsInput: false,
    geometryWarp: false,
  };
}

fs.mkdirSync(referenceRoot, { recursive: true });
const results = [];
for (const [family, time] of states) results.push(await buildState(family, time));
fs.writeFileSync(path.join(outputRoot, 'soft-natural-v3-manifest.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
