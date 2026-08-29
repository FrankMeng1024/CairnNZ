import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve('assets', 'home', 'prototypes');
const outputRoot = path.join(root, 'weather-material-polish-v1');
const generatedSourceRoot = path.join(outputRoot, 'generated-sky-sources');

const states = [
  {
    key: 'sunny-day',
    source: path.join(root, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-day-final-micro-native.png'),
    amount: 0.46,
  },
  {
    key: 'sunny-sunset',
    source: path.join(root, 'final-nz-world-sunny', 'final-micro-polish', 'sunny-evening-final-micro-native.png'),
    amount: 0.48,
  },
  {
    key: 'sunny-night',
    source: path.join(root, 'weather-full-frame-correction', 'sunny-night', 'sunny-night-star-micro-v2-native.png'),
    amount: 0.54,
    starSource: path.join(generatedSourceRoot, 'sunny-night-star-source.png'),
    starStrength: 1.7,
  },
  {
    key: 'cloudy-day',
    source: path.join(root, 'weather-full-frame-correction', 'cloudy', 'cloudy-day-full-frame-native.png'),
    amount: 0.42,
  },
  {
    key: 'cloudy-sunset',
    source: path.join(root, 'weather-full-frame-correction', 'cloudy', 'cloudy-sunset-full-frame-native.png'),
    amount: 0.46,
  },
  {
    key: 'cloudy-night',
    source: path.join(root, 'weather-full-frame-correction', 'cloudy', 'cloudy-night-full-frame-native.png'),
    amount: 0.5,
  },
  {
    key: 'rainy-day',
    source: path.join(root, 'weather-full-frame-correction', 'rainy', 'rainy-day-full-frame-native.png'),
    amount: 0.38,
  },
  {
    key: 'rainy-sunset',
    source: path.join(root, 'weather-full-frame-correction', 'rainy', 'rainy-sunset-full-frame-native.png'),
    amount: 0.42,
  },
  {
    key: 'rainy-night',
    source: path.join(root, 'weather-full-frame-correction', 'rainy', 'rainy-night-full-frame-native.png'),
    amount: 0.46,
  },
  {
    key: 'snowy-day',
    source: path.join(root, 'weather-full-frame-correction', 'snowy', 'snowy-day-full-frame-native.png'),
    amount: 0.52,
  },
  {
    key: 'snowy-sunset',
    source: path.join(root, 'weather-full-frame-correction', 'snowy', 'snowy-sunset-full-frame-native.png'),
    amount: 0.55,
  },
  {
    key: 'snowy-night',
    source: path.join(root, 'weather-full-frame-correction', 'snowy', 'snowy-night-full-frame-native.png'),
    amount: 0.58,
    starSource: path.join(generatedSourceRoot, 'snowy-night-star-source.png'),
    starStrength: 2,
  },
];

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));

function stableNoise(x, y) {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 29, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

async function addRestrainedStars(buffer, width, height, sourcePath, strength) {
  const candidate = await sharp(sourcePath)
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
  const candidateSoft = await sharp(sourcePath)
    .resize(width, height, { fit: 'fill' })
    .blur(1.35)
    .removeAlpha()
    .raw()
    .toBuffer();

  // The clear sky is safely above every locked mountain/tree silhouette.
  // Extract only local stellar peaks; never import generated landscape or
  // low-frequency sky color. A lower keep-rate in the hero zone prevents UI
  // competition while still making the sky rewarding on a physical phone.
  const skyLimit = Math.round(height * 0.29);
  const fadeStart = Math.round(height * 0.245);
  for (let y = 0; y < skyLimit; y += 1) {
    const fade = y <= fadeStart ? 1 : 1 - ((y - fadeStart) / (skyLimit - fadeStart));
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const luminance = candidate[index] * 0.2126 + candidate[index + 1] * 0.7152 + candidate[index + 2] * 0.0722;
      const softLuminance = candidateSoft[index] * 0.2126 + candidateSoft[index + 1] * 0.7152 + candidateSoft[index + 2] * 0.0722;
      const peak = luminance - softLuminance;
      if (peak < 11) continue;

      const cellNoise = stableNoise(Math.floor(x / 3), Math.floor(y / 3));
      const keepRate = peak > 48 ? 0.86 : peak > 30 ? 0.52 : peak > 18 ? 0.24 : 0.11;
      const heroQuiet = x < width * 0.68 && y > height * 0.08 ? 0.48 : 1;
      if (cellNoise > keepRate * heroQuiet) continue;

      const lift = Math.min(48, Math.max(0, peak - 8) * 0.78) * fade * strength;
      buffer[index] = clamp(buffer[index] + lift * 0.82);
      buffer[index + 1] = clamp(buffer[index + 1] + lift * 0.92);
      buffer[index + 2] = clamp(buffer[index + 2] + lift);
      if (peak > 24) {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= skyLimit) continue;
          const neighbor = (ny * width + nx) * 3;
          const halo = lift * 0.24;
          buffer[neighbor] = clamp(buffer[neighbor] + halo * 0.8);
          buffer[neighbor + 1] = clamp(buffer[neighbor + 1] + halo * 0.9);
          buffer[neighbor + 2] = clamp(buffer[neighbor + 2] + halo);
        }
      }
    }
  }
}

async function polishState(state) {
  const image = sharp(state.source).removeAlpha();
  const metadata = await image.metadata();
  const { width, height } = metadata;
  if (!width || !height) throw new Error(`Missing dimensions: ${state.source}`);

  const original = await image.clone().raw().toBuffer();
  const softened = await sharp(state.source).removeAlpha().median(3).blur(0.55).raw().toBuffer();
  const output = Buffer.alloc(original.length);

  for (let y = 0; y < height; y += 1) {
    const yNorm = y / height;
    const zoneWeight = yNorm < 0.27 ? 0.2 : yNorm < 0.58 ? 0.78 : 1;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const difference = (
        Math.abs(original[index] - softened[index])
        + Math.abs(original[index + 1] - softened[index + 1])
        + Math.abs(original[index + 2] - softened[index + 2])
      ) / 3;

      // Attenuate synthetic micro-facets and repeated high-frequency etching,
      // but reduce the mix on major edges so silhouettes, trail geometry and
      // shoreline registration remain exact and optically crisp.
      const detailWeight = difference < 1.5
        ? 0.12
        : difference < 26
          ? 1
          : Math.max(0.3, 1 - ((difference - 26) / 82));
      const mix = state.amount * zoneWeight * detailWeight;

      output[index] = clamp(original[index] + (softened[index] - original[index]) * mix);
      output[index + 1] = clamp(original[index + 1] + (softened[index + 1] - original[index + 1]) * mix);
      output[index + 2] = clamp(original[index + 2] + (softened[index + 2] - original[index + 2]) * mix);
    }
  }

  if (state.starSource) {
    await addRestrainedStars(output, width, height, state.starSource, state.starStrength);
  }

  const family = state.key.split('-')[0];
  const familyDir = path.join(outputRoot, family);
  fs.mkdirSync(familyDir, { recursive: true });
  const nativePath = path.join(familyDir, `${state.key}-material-polish-native.png`);
  const runtimePath = path.join(familyDir, `${state.key}-material-polish-3x.jpg`);
  await sharp(output, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(nativePath);
  await sharp(output, { raw: { width, height, channels: 3 } })
    .resize(1170, 2532, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(runtimePath);
  return { key: state.key, nativePath, runtimePath, width, height, amount: state.amount };
}

fs.mkdirSync(outputRoot, { recursive: true });
const results = [];
for (const state of states) results.push(await polishState(state));
fs.writeFileSync(path.join(outputRoot, 'material-polish-manifest.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
