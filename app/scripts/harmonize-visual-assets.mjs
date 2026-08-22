import path from 'node:path';
import sharp from 'sharp';

const assets = path.resolve('assets');

const homeGrades = {
  'sunny-day': { brightness: 1.02, saturation: 0.82, slope: 0.97, lift: 2 },
  'sunny-night': { brightness: 1.20, saturation: 0.82, slope: 1.0, lift: 5 },
  'cloudy-day': { brightness: 1.18, saturation: 1.08, slope: 0.98, lift: 5 },
  'cloudy-night': { brightness: 1.48, saturation: 0.90, slope: 0.82, lift: 18 },
  'rain-day': { brightness: 1.25, saturation: 1.30, slope: 0.92, lift: 12 },
  'rain-night': { brightness: 1.48, saturation: 0.90, slope: 0.84, lift: 18 },
  'snow-day': { brightness: 1.03, saturation: 0.92, slope: 0.98, lift: 3 },
  'snow-night': { brightness: 1.24, saturation: 0.86, slope: 1.0, lift: 6 },
};

for (const [variant, grade] of Object.entries(homeGrades)) {
  const source = path.join(assets, 'home', `home-bg-${variant}.jpg`);
  const output = path.join(assets, 'home', `home-bg-${variant}-harmonized-3x.jpg`);
  await sharp(source)
    .resize(1170, 2532, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .modulate({ brightness: grade.brightness, saturation: grade.saturation })
    .linear(grade.slope, grade.lift)
    .sharpen({ sigma: 0.45 })
    .jpeg({ quality: 90, progressive: true, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(output);
}

const friendsGrades = [
  ['backgrounds/friends-bg-day.png', 'backgrounds/friends-bg-day-harmonized.png', 1.01, 0.72, 0.94, 6],
  ['backgrounds/friends-bg-night.png', 'backgrounds/friends-bg-night-harmonized.png', 1.12, 0.65, 0.95, 5],
  ['hero/add-friend-hero-day.png', 'hero/add-friend-hero-day-harmonized.png', 1.01, 0.76, 0.95, 5],
  ['hero/add-friend-hero-night.png', 'hero/add-friend-hero-night-harmonized.png', 1.12, 0.68, 0.95, 5],
];

for (const [inputName, outputName, brightness, saturation, slope, lift] of friendsGrades) {
  const source = path.join(assets, 'friends', inputName);
  const output = path.join(assets, 'friends', outputName);
  await sharp(source)
    .modulate({ brightness, saturation })
    .linear(slope, lift)
    .blur(0.35)
    .sharpen({ sigma: 0.3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
}

console.log('Created eight Home and four Friends harmonized derivatives; source assets remain unchanged.');
