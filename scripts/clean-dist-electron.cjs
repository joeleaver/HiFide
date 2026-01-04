const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist-electron');

console.log('Checking for stale dist-electron folder...');

if (fs.existsSync(distDir)) {
  console.log('Removing dist-electron...');
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('dist-electron removed successfully.');
} else {
  console.log('dist-electron not found, skipping cleanup.');
}
