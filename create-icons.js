// Node.js script to create icons for the extension
const fs = require('fs');
const path = require('path');

// Create a simple SVG icon
const createSVGIcon = (size) => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${size * 0.1}" fill="#8b5cf6"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.6}" 
        fill="white" text-anchor="middle" dominant-baseline="central">⚡</text>
</svg>`;
};

// Create SVG files
const sizes = [16, 32, 48, 128];
sizes.forEach(size => {
  const svg = createSVGIcon(size);
  fs.writeFileSync(path.join(__dirname, 'icons', `icon${size}.svg`), svg);
});

console.log('SVG icons created successfully!');
console.log('To convert to PNG, you can:');
console.log('1. Use an online SVG to PNG converter');
console.log('2. Use ImageMagick: convert icon16.svg icon16.png');
console.log('3. Use the browser method in create_icons.html');