// build-groq.js - Build Groq test version to dist-groq/
// Usage: node build-groq.js

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist-groq');

// Obfuscation config - strong protection but keeps extension working
const OBFUSCATE_CONFIG = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, // Don't rename globals (chrome, window, document)
  selfDefending: false, // Can cause issues in extensions
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 10,
  transformObjectKeys: true,
  unicodeEscapeSequence: false // Keep readable for debugging if needed
};

// Files/patterns to NOT obfuscate (just copy as-is)
const SKIP_OBFUSCATE = [
  'manifest.json',
  'fab-button.js',
  '.css',
  '.html',
  '.png',
  '.jpg',
  '.svg',
  '.ico'
];

function shouldObfuscate(filePath) {
  if (!filePath.endsWith('.js')) return false;
  const name = path.basename(filePath);
  return !SKIP_OBFUSCATE.includes(name);
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (shouldObfuscate(srcPath)) {
      // Obfuscate JS files
      try {
        const code = fs.readFileSync(srcPath, 'utf-8');
        console.log(`  Obfuscating: ${path.relative(SRC_DIR, srcPath)}`);
        const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATE_CONFIG);
        fs.writeFileSync(destPath, result.getObfuscatedCode());
      } catch (e) {
        console.error(`  ERROR obfuscating ${srcPath}: ${e.message}`);
        // Fallback: copy original
        fs.copyFileSync(srcPath, destPath);
      }
    } else {
      // Copy non-JS files as-is
      console.log(`  Copying: ${path.relative(SRC_DIR, srcPath)}`);
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Main
console.log('==========================================');
console.log('  Building GROQ TEST VERSION -> dist-groq/...');
console.log('==========================================');
console.log();

// Clean dist-groq (no .git preservation - this is a fresh test dist)
if (fs.existsSync(DIST_DIR)) {
  try {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    console.log('Cleaned dist-groq/');
  } catch (e) {
    console.error('Khong the xoa dist-groq/ - Dong tat ca cua so dang mo trong thu muc dist-groq/ roi thu lai.');
    process.exit(1);
  }
}

console.log('Building from src/ -> dist-groq/...');
console.log();

copyDir(SRC_DIR, DIST_DIR);

console.log();
console.log('==========================================');
console.log('  BUILD COMPLETE!');
console.log(`  Output: ${DIST_DIR}`);
console.log('  Load dist-groq/ in Chrome to test.');
console.log('==========================================');
