const fs = require('fs');
const code = fs.readFileSync('d:/Code of Content/destrade-mobile/www/js/app.js', 'utf8');
const lines = code.split('\n');

for (let i = 1; i <= lines.length; i++) {
    const chunk = lines.slice(0, i).join('\n');
    try {
        new Function(chunk);
    } catch (e) {
        if (!e.message.includes('Unexpected end of input') && !e.message.includes('Unexpected token')) {
            // Unexpected end of input is normal when code is truncated
        } else if (e.message.includes('Unexpected token \'{\'') || e.message.includes('Unexpected token {')) {
            console.log(`FOUND SYNTAX ERROR AT LINE ${i}:`);
            console.log(`Line ${i}:`, lines[i - 1]);
            console.log(`Context:\n${lines.slice(Math.max(0, i - 10), i + 5).join('\n')}`);
            break;
        }
    }
}
