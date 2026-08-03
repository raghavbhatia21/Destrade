const fs = require('fs');
const path = require('path');

const filePath = 'd:\\Code of Content\\destrade-mobile\\www\\js\\nse-api.js';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);
for (let i = 580; i <= 595; i++) {
    const line = lines[i - 1];
    if (line !== undefined) {
        console.log(`Line ${i}: [${line}]`);
        const bytes = Buffer.from(line);
        console.log(`   Hex: ${bytes.toString('hex')}`);
    }
}
