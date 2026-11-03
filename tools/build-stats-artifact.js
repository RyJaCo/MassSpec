// Bundles stats.html, its CSS and its scripts into one self-contained page for publishing as a
// Claude artifact (the artifact host adds the doctype/head/body skeleton itself).
// Run: node tools/build-stats-artifact.js [out]   (default: dist/stats-advisor.html)
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PEPTIDE_ARTIFACT = 'https://claude.ai/artifact/7KaarGoJDfThT7DE7qT8AD';

const html = read('stats.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/<script src="[^"]+"><\/script>\s*/g, '')
  .replace('<a href="index.html">', `<a href="${PEPTIDE_ARTIFACT}" target="_blank" rel="noopener">`);

// Side gutter that also clears a phone's side system bar.
const css = read('css/style.css') + '\n' + read('css/stats.css') + `
.page { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
`;
const scripts = ['js/statlib.js', 'js/advisor.js', 'js/analyse.js', 'js/stats-demo.js', 'js/stats-app.js']
  .map((p) => `<script>\n${read(p).replace(/<\/script/gi, '<\\/script')}\n</script>`).join('\n');

const out = `<title>Stats Test Advisor</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
${css}
</style>
${body.trim()}
${scripts}
`;
const dest = path.resolve(root, process.argv[2] || 'dist/stats-advisor.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`wrote ${path.relative(root, dest)} (${(out.length / 1024).toFixed(0)} KB)`);
