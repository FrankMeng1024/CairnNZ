import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const prototypeRoot = path.resolve('assets', 'home', 'prototypes');
const inputRoot = path.join(prototypeRoot, 'weather-material-polish-v1');
const outputRoot = path.join(prototypeRoot, 'weather-material-polish-v2');
const starRoot = path.join(outputRoot, 'generated-sky-sources');
const keys = [
  'sunny-day', 'sunny-sunset', 'sunny-night',
  'cloudy-day', 'cloudy-sunset', 'cloudy-night',
  'rainy-day', 'rainy-sunset', 'rainy-night',
  'snowy-day', 'snowy-sunset', 'snowy-night',
];

const starSources = {
  'sunny-night': path.join(starRoot, 'sunny-night-natural-star-source.png'),
  'snowy-night': path.join(starRoot, 'snowy-night-natural-star-source.png'),
};

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function stableNoise(x, y) {
  let value = Math.imul(x + 31, 374761393) ^ Math.imul(y + 47, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function skylineAt(x) {
  if (x < 0.25) return 0.285;
  if (x < 0.58) return 0.34 + ((x - 0.25) / 0.33) * 0.12;
  return 0.46 - ((x - 0.58) / 0.42) * 0.18;
}

function waterWeight(x, y) {
  if (x < 0.39 || y < 0.47 || y > 0.625) return 0;
  const xFade = smoothstep(0.39, 0.49, x);
  const top = 0.486 + Math.max(0, x - 0.48) * 0.01;
  const bottom = 0.515 + Math.max(0, x - 0.39) * 0.13;
  const topFade = smoothstep(top, top + 0.016, y);
  const bottomFade = 1 - smoothstep(bottom - 0.022, bottom, y);
  return xFade * topFade * bottomFade;
}

function materialWeight(x, y) {
  const skyline = skylineAt(x);
  const mountain = smoothstep(skyline + 0.012, skyline + 0.04, y)
    * (1 - smoothstep(0.50, 0.56, y));
  const ground = smoothstep(0.51, 0.64, y) * 0.52;
  return Math.max(mountain * 0.68, ground);
}

async function enrichNightSky(buffer, width, height, sourcePath, strength) {
  const resized = sharp(sourcePath).resize(width, height, { fit: 'fill' }).removeAlpha();
  const source = await resized.clone().raw().toBuffer();
  const soft = await resized.clone().blur(1.4).raw().toBuffer();
  const band = await resized.clone().blur(18).raw().toBuffer();
  const broad = await resized.clone().blur(62).raw().toBuffer();
  const skyLimit = Math.round(height * 0.285);

  for (let y = 0; y < skyLimit; y += 1) {
    const yNorm = y / height;
    const edgeFade = 1 - smoothstep(0.245, 0.285, yNorm);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const lum = source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722;
      const softLum = soft[i] * 0.2126 + soft[i + 1] * 0.7152 + soft[i + 2] * 0.0722;
      const peak = lum - softLum;
      const heroQuiet = x < width * 0.69 && yNorm > 0.075 ? 0.42 : 1;
      const keep = peak > 42 ? 0.75 : peak > 25 ? 0.38 : peak > 14 ? 0.12 : 0;
      if (keep && stableNoise(Math.floor(x / 3), Math.floor(y / 3)) < keep * heroQuiet) {
        const lift = Math.min(30, Math.max(0, peak - 9) * 0.52) * edgeFade * strength;
        buffer[i] = clamp(buffer[i] + lift * 0.78);
        buffer[i + 1] = clamp(buffer[i + 1] + lift * 0.9);
        buffer[i + 2] = clamp(buffer[i + 2] + lift);
      }

      // Import only a whisper of generated large-scale sky richness. This is
      // high-pass atmospheric structure, not generated landscape or geometry.
      const bandLum = band[i] * 0.2126 + band[i + 1] * 0.7152 + band[i + 2] * 0.0722;
      const broadLum = broad[i] * 0.2126 + broad[i + 1] * 0.7152 + broad[i + 2] * 0.0722;
      const richness = Math.max(-3, Math.min(5, (bandLum - broadLum) * 0.12))
        * edgeFade * heroQuiet * strength;
      buffer[i] = clamp(buffer[i] + richness * 0.45);
      buffer[i + 1] = clamp(buffer[i + 1] + richness * 0.65);
      buffer[i + 2] = clamp(buffer[i + 2] + richness);
    }
  }
}

async function processState(key) {
  const family = key.split('-')[0];
  const input = path.join(inputRoot, family, `${key}-material-polish-native.png`);
  const image = sharp(input).removeAlpha();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error(`Missing dimensions for ${key}`);

  const original = await image.clone().raw().toBuffer();
  const natural = await image.clone().median(3).blur(0.72).raw().toBuffer();
  const water = await image.clone().convolve({
    width: 7, height: 3,
    kernel: [1, 2, 3, 4, 3, 2, 1, 2, 4, 6, 8, 6, 4, 2, 1, 2, 3, 4, 3, 2, 1],
    scale: 54,
  }).blur(0.48).raw().toBuffer();
  const output = Buffer.from(original);

  for (let y = 0; y < height; y += 1) {
    const yn = y / height;
    for (let x = 0; x < width; x += 1) {
      const xn = x / width;
      const i = (y * width + x) * 3;
      const material = materialWeight(xn, yn);
      const waterMask = waterWeight(xn, yn);
      const diff = (
        Math.abs(original[i] - natural[i])
        + Math.abs(original[i + 1] - natural[i + 1])
        + Math.abs(original[i + 2] - natural[i + 2])
      ) / 3;
      // Major edges retain registration; repeated medium-frequency etching is
      // where the correction is strongest.
      const edgeGuard = diff > 46 ? 0.24 : diff > 30 ? 0.55 : 1;
      const materialMix = material * 0.48 * edgeGuard;
      for (let c = 0; c < 3; c += 1) {
        output[i + c] = clamp(original[i + c] + (natural[i + c] - original[i + c]) * materialMix);
      }

      if (waterMask > 0) {
        const luminance = original[i] * 0.2126 + original[i + 1] * 0.7152 + original[i + 2] * 0.0722;
        const waterLum = water[i] * 0.2126 + water[i + 1] * 0.7152 + water[i + 2] * 0.0722;
        const brightPeak = luminance - waterLum;
        // Preserve sparse, real sparkle; suppress broad triangular/shard-like
        // highlight cells and crystalline ripple edges.
        const sparklePreserve = brightPeak > 16 && luminance > 118 ? 0.28 : 1;
        const waterMix = waterMask * 0.74 * sparklePreserve;
        for (let c = 0; c < 3; c += 1) {
          output[i + c] = clamp(output[i + c] + (water[i + c] - output[i + c]) * waterMix);
        }
      }
    }
  }

  if (starSources[key]) {
    await enrichNightSky(output, width, height, starSources[key], key === 'snowy-night' ? 0.78 : 0.66);
  }

  const familyDir = path.join(outputRoot, family);
  fs.mkdirSync(familyDir, { recursive: true });
  const nativePath = path.join(familyDir, `${key}-material-natural-v2-native.png`);
  const runtimePath = path.join(familyDir, `${key}-material-natural-v2-3x.jpg`);
  await sharp(output, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(nativePath);
  await sharp(output, { raw: { width, height, channels: 3 } })
    .resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(runtimePath);
  return { key, input, nativePath, runtimePath, width, height, geometryWarp: false };
}

fs.mkdirSync(outputRoot, { recursive: true });
const results = [];
for (const key of keys) results.push(await processState(key));
fs.writeFileSync(path.join(outputRoot, 'material-naturalism-v2-manifest.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
