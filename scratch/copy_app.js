const fs = require('fs');

fs.copyFileSync('d:\\Code of Content\\destrade\\js\\app.js', 'd:\\Code of Content\\destrade-mobile\\www\\js\\app.js');
console.log('✅ Copied clean destrade/js/app.js to destrade-mobile/www/js/app.js');

fs.copyFileSync('d:\\Code of Content\\destrade\\js\\nse-api.js', 'd:\\Code of Content\\destrade-mobile\\www\\js\\nse-api.js');
console.log('✅ Copied clean destrade/js/nse-api.js to destrade-mobile/www/js/nse-api.js');
