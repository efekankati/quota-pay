const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Minimal valid PNG buffer (base64)
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const pngBuffer = Buffer.from(pngBase64, 'base64');

const files = [
  'icon.png',
  'splash-icon.png',
  'adaptive-icon.png',
  'favicon.png',
];

files.forEach((file) => {
  const filePath = path.join(assetsDir, file);
  fs.writeFileSync(filePath, pngBuffer);
  console.log(`Created asset: ${filePath}`);
});

console.log('All placeholder assets generated successfully.');
