const fs = require('fs');
const content = fs.readFileSync('d:/Code of Content/destrade-mobile/www/js/nse-api.js', 'utf8');
const lines = content.split('\n');
console.log('Total Lines:', lines.length);
for (let i = 810; i <= 830; i++) {
    if (lines[i - 1] !== undefined) {
        console.log(`Line ${i}: ${JSON.stringify(lines[i - 1])}`);
    }
}
