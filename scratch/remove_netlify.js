const fs = require('fs');
const path = require('path');

const tomlFile = path.join(__dirname, '..', 'netlify.toml');
const netlifyDir = path.join(__dirname, '..', 'netlify');

if (fs.existsSync(tomlFile)) {
    fs.unlinkSync(tomlFile);
    console.log('🗑️ Deleted netlify.toml');
}

if (fs.existsSync(netlifyDir)) {
    fs.rmSync(netlifyDir, { recursive: true, force: true });
    console.log('🗑️ Deleted netlify/ directory and all function scripts');
}

console.log('✨ Netlify system completely removed!');
