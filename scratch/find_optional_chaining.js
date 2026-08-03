const fs = require('fs');
const lines = fs.readFileSync('d:\\Code of Content\\destrade-mobile\\www\\js\\nse-api.js', 'utf8').split('\n');
lines.forEach((l, i) => {
    if (l.includes('?.')) console.log((i + 1) + ': ' + l.trim());
});
console.log('\n--- Done. Total lines:', lines.length);
