const fs = require('fs');

function checkFile(filepath) {
    const code = fs.readFileSync(filepath, 'utf8');
    try {
        new Function(code);
        console.log(`✅ ${filepath}: Valid JS Function Syntax`);
    } catch (e) {
        console.error(`❌ ${filepath}: ${e.name} - ${e.message}`);
        // Find line number
        const lines = code.split('\n');
        for (let i = 1; i <= lines.length; i++) {
            try {
                new Function(lines.slice(0, i).join('\n'));
            } catch (err) {
                console.error(`First error around line ${i}: ${lines[i-1]}`);
                break;
            }
        }
    }
}

checkFile('d:/Code of Content/destrade-mobile/www/js/nse-api.js');
checkFile('d:/Code of Content/destrade-mobile/www/js/app.js');
