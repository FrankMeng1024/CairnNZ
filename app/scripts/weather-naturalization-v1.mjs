import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const prototypeRoot = path.resolve('assets', 'home', 'prototypes');
const rollbackRoot = path.join(prototypeRoot, 'weather-material-polish-v1');
const outputRoot = path.join(prototypeRoot, 'weather-naturalization-v1');
const skySourcePath = path.join(outputRoot, 'sources', 'restrained-natural-night-sky.png');
const lockedParentByTime = {
  day: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-day-final-micro-native.png'),
  sunset: path.join(prototypeRoot, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-evening-final-micro-native.png'),
  night: path.join(prototypeRoot, 'deep-night-exploration', 'deep-night-starlight-native.png'),
};

// Existing Home registration compensation, converted below from the 390x844
// review frame to each native output. It aligns the locked material reference
// to the rollback raster without changing output geometry.
const registration = {
  'cloudy-day': { x: 1.54, y: -0.95 },
  'rainy-day': { x: 0.26, y: -1.66 },
  'snowy-day': { x: 0, y: -0.12 },
};

const states = [
  ['cloudy', 'day'], ['cloudy', 'sunset'], ['cloudy', 'night'],
  ['rainy', 'day'], ['rainy', 'sunset'], ['rainy', 'night'],
  ['snowy', 'day'], ['snowy', 'sunset'], ['snowy', 'night'],
];

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function waterWeight(x, y) {
  if (x < 0.39 || y < 0.46 || y > 0.64) return 0;
  const left = smoothstep(0.39, 0.49, x);
  const top = 0.486 + Math.max(0, x - 0.48) * 0.01;
  const bottom = 0.515 + Math.max(0, x - 0.39) * 0.13;
  const topFade = smoothstep(top - 0.008, top + 0.018, y);
  const bottomFade = 1 - smoothstep(bottom - 0.028, bottom + 0.008, y);
  return left * topFade * bottomFade;
}

function referenceDetailWeight(weather) {
  if (weather === 'rainy') return 0.68;
  if (weather === 'snowy') return 0.64;
  return 0.74;
}

async function addNaturalSky(output, width, height, strength) {
  const skyHeight = Math.round(height * 0.292);
  const sky = await sharp(skySourcePath)
    .resize(width, skyHeight, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  for (let y = 0; y < skyHeight; y += 1) {
    const yn = y / skyHeight;
    const horizonFade = 1 - smoothstep(0.7, 1, yn);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const heroQuiet = x < width * 0.72 && y > skyHeight * 0.18 ? 0.48 : 1;
      const alpha = strength * horizonFade * heroQuiet;
      // Blend a continuous celestial field rather than extracting point peaks.
      // Preserve the locked sky color by limiting contribution to luminance
      // organization and subtle cool chroma.
      const sourceLum = sky[i] * 0.2126 + sky[i + 1] * 0.7152 + sky[i + 2] * 0.0722;
      const baseLum = output[i] * 0.2126 + output[i + 1] * 0.7152 + output[i + 2] * 0.0722;
      const targetLift = Math.max(-8, Math.min(24, sourceLum - 28));
      const targetLum = clamp(baseLum + targetLift);
      const ratio = baseLum > 1 ? targetLum / baseLum : 1;
      output[i] = clamp(output[i] * (1 - alpha) + output[i] * ratio * alpha * 0.92);
      output[i + 1] = clamp(output[i + 1] * (1 - alpha) + output[i + 1] * ratio * alpha * 0.97);
      output[i + 2] = clamp(output[i + 2] * (1 - alpha) + output[i + 2] * ratio * alpha * 1.06);

      // Sparse brighter anchors remain source-driven but subordinate.
      if (sourceLum > 105) {
        const starAlpha = alpha * Math.min(0.42, (sourceLum - 105) / 220);
        output[i] = clamp(output[i] + (sky[i] - output[i]) * starAlpha);
        output[i + 1] = clamp(output[i + 1] + (sky[i + 1] - output[i + 1]) * starAlpha);
        output[i + 2] = clamp(output[i + 2] + (sky[i + 2] - output[i + 2]) * starAlpha);
      }
    }
  }
}

function detailEnergy(original, smooth, width, height, fromY, toY) {
  let total = 0;
  let count = 0;
  const start = Math.floor(height * fromY);
  const end = Math.min(height, Math.ceil(height * toY));
  for (let y = start; y < end; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      total += Math.abs(original[i] - smooth[i])
        + Math.abs(original[i + 1] - smooth[i + 1])
        + Math.abs(original[i + 2] - smooth[i + 2]);
      count += 3;
    }
  }
  return count ? Number((total / count).toFixed(3)) : 0;
}

async function naturalize(inputPath, weather, time) {
  const image = sharp(inputPath).removeAlpha();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`Missing dimensions: ${inputPath}`);

  const original = await image.clone().raw().toBuffer();
  const detailSigma = weather === 'snowy' ? 1.55 : 1.8;
  const natural = await image.clone().blur(detailSigma).raw().toBuffer();
  const lockedReference = sharp(lockedParentByTime[time]).removeAlpha().resize(width, height, { fit: 'fill' });
  const reference = await lockedReference.clone().raw().toBuffer();
  const referenceLow = await lockedReference.clone().blur(detailSigma).raw().toBuffer();
  const horizontalKernel = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  const verticalKernel = [1, 2, 1];
  const waterKernel = verticalKernel.flatMap(v => horizontalKernel.map(h => v * h));
  const water = await image.clone().convolve({
    width: horizontalKernel.length,
    height: verticalKernel.length,
    kernel: waterKernel,
    scale: waterKernel.reduce((sum, value) => sum + value, 0),
  }).blur(0.45).raw().toBuffer();
  const output = Buffer.alloc(original.length);

  for (let y = 0; y < height; y += 1) {
    const yn = y / height;
    for (let x = 0; x < width; x += 1) {
      const xn = x / width;
      const i = (y * width + x) * 3;
      const waterMix = waterWeight(xn, yn) * 0.78;
      const detailMix = referenceDetailWeight(weather);
      const skyKeep = 1 - smoothstep(0.265, 0.345, yn);
      const offset = registration[`${weather}-${time}`] ?? { x: 0, y: 0 };
      const sx = Math.max(0, Math.min(width - 1, Math.round(x + offset.x * width / 390)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(y + offset.y * height / 844)));
      const ri = (sy * width + sx) * 3;

      for (let c = 0; c < 3; c += 1) {
        // Frequency replacement: V1 remains the weather/color/atmosphere base,
        // while the locked Sunny member restores natural material frequency.
        // The complete V1 sky (including rain) is retained above the terrain.
        const referenceDetail = reference[ri + c] - referenceLow[ri + c];
        const edgeMagnitude = Math.max(
          Math.abs(reference[ri] - referenceLow[ri]),
          Math.abs(reference[ri + 1] - referenceLow[ri + 1]),
          Math.abs(reference[ri + 2] - referenceLow[ri + 2]),
        );
        const silhouetteGuard = 1 - smoothstep(12, 34, edgeMagnitude);
        const landscapeGate = smoothstep(0.285, 0.42, yn);
        const reconstructed = natural[i + c]
          + referenceDetail * detailMix * silhouetteGuard * landscapeGate * (1 - waterMix);
        let value = original[i + c] * skyKeep + reconstructed * (1 - skyKeep);
        if (waterMix > 0) value += (water[i + c] - value) * waterMix;
        output[i + c] = clamp(value);
      }
    }
  }

  if (weather === 'snowy' && time === 'night') {
    await addNaturalSky(output, width, height, 0.38);
  }

  const outputDir = path.join(outputRoot, weather);
  fs.mkdirSync(outputDir, { recursive: true });
  const key = `${weather}-${time}`;
  const nativePath = path.join(outputDir, `${key}-naturalized-v1-native.png`);
  const runtimePath = path.join(outputDir, `${key}-naturalized-v1-3x.jpg`);
  await sharp(output, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(nativePath);
  await sharp(output, { raw: { width, height, channels: 3 } })
    .resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(runtimePath);

  const outputSmooth = await sharp(output, { raw: { width, height, channels: 3 } })
    .blur(0.92)
    .raw()
    .toBuffer();
  return {
    key,
    parent: inputPath,
    lockedMaterialReference: lockedParentByTime[time],
    nativePath,
    runtimePath,
    width,
    height,
    geometryWarp: false,
    textureEnergy: {
      upperBefore: detailEnergy(original, natural, width, height, 0, 0.34),
      upperAfter: detailEnergy(output, outputSmooth, width, height, 0, 0.34),
      middleBefore: detailEnergy(original, natural, width, height, 0.34, 0.66),
      middleAfter: detailEnergy(output, outputSmooth, width, height, 0.34, 0.66),
      lowerBefore: detailEnergy(original, natural, width, height, 0.66, 1),
      lowerAfter: detailEnergy(output, outputSmooth, width, height, 0.66, 1),
    },
  };
}

async function sunnyNightCandidate() {
  const inputPath = path.join(prototypeRoot, 'deep-night-exploration', 'deep-night-starlight-native.png');
  const image = sharp(inputPath).removeAlpha();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`Missing dimensions: ${inputPath}`);
  const output = Buffer.from(await image.clone().raw().toBuffer());
  await addNaturalSky(output, width, height, 0.34);
  const outputDir = path.join(outputRoot, 'sunny');
  fs.mkdirSync(outputDir, { recursive: true });
  const nativePath = path.join(outputDir, 'sunny-night-natural-sky-v1-native.png');
  const runtimePath = path.join(outputDir, 'sunny-night-natural-sky-v1-3x.jpg');
  await sharp(output, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(nativePath);
  await sharp(output, { raw: { width, height, channels: 3 } })
    .resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(runtimePath);
  return { key: 'sunny-night', parent: inputPath, nativePath, runtimePath, width, height, geometryWarp: false, skyOnly: true };
}

if (!fs.existsSync(skySourcePath)) throw new Error(`Missing generated sky source: ${skySourcePath}`);
fs.mkdirSync(outputRoot, { recursive: true });
const results = [];
for (const [weather, time] of states) {
  const input = path.join(rollbackRoot, weather, `${weather}-${time}-material-polish-native.png`);
  results.push(await naturalize(input, weather, time));
}
results.push(await sunnyNightCandidate());
fs.writeFileSync(path.join(outputRoot, 'naturalization-manifest.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
