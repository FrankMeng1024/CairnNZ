import path from 'node:path';
import sharp from 'sharp';

const homeDir = path.resolve('assets', 'home');
for (const weather of ['sunny', 'cloudy', 'rain', 'snow']) {
  const source = path.join(homeDir, `home-bg-${weather}-night.jpg`);
  const output = path.join(homeDir, `home-bg-${weather}-night-3x.jpg`);
  await sharp(source)
    .resize(1170, 2532, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .modulate({ brightness: 1.18, saturation: 1.02 })
    .sharpen({ sigma: 0.5 })
    .jpeg({ quality: 90, progressive: true, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(output);
}

console.log('Refreshed four inviting-night 3x Home derivatives; originals unchanged.');
