import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

/**
 * Delivery pass for the locked-Sunny-parent weather rebuild.
 *
 * Input policy is intentionally narrow:
 *   1. one generated edit derived directly from the matching locked Sunny parent;
 *   2. the locked Sunny parent itself, used only as immutable lineage evidence.
 *
 * No historical weather raster, weather-material V1/V2/V3 output, or legacy
 * full-frame correction is read by this script.
 */
const prototypeRoot = path.resolve('assets', 'home', 'prototypes');
const outputRoot = path.join(prototypeRoot, 'locked-sunny-weather-rebuild-v1');
const sourceRoot = path.join(outputRoot, 'source-edits');

const parents = {
  day: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-day-final-micro-native.png'),
  sunset: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-evening-final-micro-native.png'),
  night: path.join(prototypeRoot, 'deep-night-exploration', 'deep-night-starlight-native.png'),
};

const states = [
  { family: 'cloudy', time: 'day', brightness: 0.99, saturation: 0.98, softness: 0.58, skySoftness: 0.10, waterSoftness: 0.92 },
  { family: 'rainy', time: 'day', brightness: 1.07, saturation: 1.04, softness: 0.62, skySoftness: 0.18, waterSoftness: 0.95 },
  { family: 'snowy', time: 'day', brightness: 0.97, saturation: 0.94, softness: 0.72, skySoftness: 0.12, waterSoftness: 0.96 },
  { family: 'cloudy', time: 'sunset', brightness: 1.10, saturation: 0.97, softness: 0.62, skySoftness: 0.12, waterSoftness: 0.94 },
  { family: 'rainy', time: 'sunset', brightness: 1.17, saturation: 1.00, softness: 0.67, skySoftness: 0.20, waterSoftness: 0.96 },
  { family: 'snowy', time: 'sunset', brightness: 1.08, saturation: 0.95, softness: 0.72, skySoftness: 0.10, waterSoftness: 0.96 },
  { family: 'cloudy', time: 'night', brightness: 1.16, saturation: 0.94, softness: 0.70, skySoftness: 0.42, waterSoftness: 0.96 },
  { family: 'rainy', time: 'night', brightness: 1.17, saturation: 0.96, softness: 0.72, skySoftness: 0.48, waterSoftness: 0.97 },
  { family: 'snowy', time: 'night', brightness: 1.10, saturation: 0.94, softness: 0.74, skySoftness: 0.02, waterSoftness: 0.97 },
];

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

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

function terrainSoftness(x, y, config) {
  const skyline = skylineAt(x);
  const sky = 1 - smoothstep(skyline - 0.02, skyline + 0.012, y);
  const distant = smoothstep(skyline - 0.004, skyline + 0.035, y) * (1 - smoothstep(0.51, 0.60, y));
  const mid = smoothstep(0.47, 0.57, y) * (1 - smoothstep(0.68, 0.78, y));
  const foreground = smoothstep(0.61, 0.80, y);
  const terrain = Math.max(distant * 0.92, mid * 0.73, foreground * config.softness);
  return Math.max(sky * config.skySoftness, terrain);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function buildState(config) {
  const key = `${config.family}-${config.time}`;
  const input = path.join(sourceRoot, `${key}-generated.png`);
  const parent = parents[config.time];
  if (!fs.existsSync(input) || !fs.existsSync(parent)) {
    throw new Error(`Missing locked input for ${key}`);
  }

  const parentMeta = await sharp(parent).metadata();
  const inputMeta = await sharp(input).metadata();
  if (inputMeta.width !== parentMeta.width || inputMeta.height !== parentMeta.height) {
    throw new Error(`${key} geometry ${inputMeta.width}x${inputMeta.height} does not match ${config.time} parent ${parentMeta.width}x${parentMeta.height}`);
  }

  const width = parentMeta.width;
  const height = parentMeta.height;
  const prepared = sharp(input)
    .removeAlpha()
    .modulate({ brightness: config.brightness, saturation: config.saturation });
  const original = await prepared.clone().raw().toBuffer();
  const organic = await prepared.clone().median(3).blur(0.78).raw().toBuffer();
  const broad = await prepared.clone().blur(2.2).raw().toBuffer();
  const waterOrganic = await prepared.clone().median(5).blur(1.65).raw().toBuffer();
  const output = Buffer.from(original);

  for (let y = 0; y < height; y += 1) {
    const yn = y / height;
    for (let x = 0; x < width; x += 1) {
      const xn = x / width;
      const i = (y * width + x) * 3;
      const terrain = terrainSoftness(xn, yn, config);
      const water = waterWeight(xn, yn) * config.waterSoftness;
      for (let channel = 0; channel < 3; channel += 1) {
        let value = original[i + channel];
        value += (organic[i + channel] - value) * terrain;
        if (terrain > 0.48) {
          value += (broad[i + channel] - value) * (terrain - 0.48) * 0.24;
        }
        if (water > 0) {
          value += (waterOrganic[i + channel] - value) * water;
        }
        output[i + channel] = clamp(value);
      }
    }
  }

  const familyDir = path.join(outputRoot, config.family);
  fs.mkdirSync(familyDir, { recursive: true });
  const nativePath = path.join(familyDir, `${key}-locked-parent-v1-native.png`);
  const runtimePath = path.join(familyDir, `${key}-locked-parent-v1-3x.jpg`);
  const image = sharp(output, { raw: { width, height, channels: 3 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(nativePath);
  await image.clone()
    .resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(runtimePath);

  return {
    state: key,
    lockedParent: parent,
    lockedParentSha256: sha256(parent),
    generatedEdit: input,
    generatedEditSha256: sha256(input),
    nativeOutput: nativePath,
    nativeSha256: sha256(nativePath),
    runtimeOutput: runtimePath,
    runtimeSha256: sha256(runtimePath),
    nativeDimensions: `${width}x${height}`,
    runtimeDimensions: '1170x2532',
    legacyWeatherRasterUsed: false,
    v1V2V3WeatherRasterUsed: false,
    geometryResizeOrWarp: false,
  };
}

const results = [];
for (const state of states) {
  results.push(await buildState(state));
}

const sunnyNightReviewInput = path.join(sourceRoot, 'sunny-night-sky-review-generated.png');
let sunnyNightReview = null;
if (fs.existsSync(sunnyNightReviewInput)) {
  const parent = parents.night;
  const parentMeta = await sharp(parent).metadata();
  const reviewMeta = await sharp(sunnyNightReviewInput).metadata();
  if (reviewMeta.width !== parentMeta.width || reviewMeta.height !== parentMeta.height) {
    throw new Error('Sunny Night review candidate does not match the locked Night parent dimensions');
  }
  const reviewDir = path.join(outputRoot, 'sunny-review');
  fs.mkdirSync(reviewDir, { recursive: true });
  const nativePath = path.join(reviewDir, 'sunny-night-sky-review-v1-native.png');
  const runtimePath = path.join(reviewDir, 'sunny-night-sky-review-v1-3x.jpg');
  await sharp(sunnyNightReviewInput).png({ compressionLevel: 9 }).toFile(nativePath);
  await sharp(sunnyNightReviewInput)
    .resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(runtimePath);
  sunnyNightReview = {
    lockedParent: parent,
    lockedParentSha256: sha256(parent),
    nativeOutput: nativePath,
    nativeSha256: sha256(nativePath),
    runtimeOutput: runtimePath,
    runtimeSha256: sha256(runtimePath),
    productionMappingChanged: false,
  };
}

const lineagePath = path.join(outputRoot, 'locked-parent-lineage.json');
fs.writeFileSync(lineagePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), results, sunnyNightReview }, null, 2)}\n`);
console.log(JSON.stringify({ outputRoot, lineagePath, states: results.length }, null, 2));
