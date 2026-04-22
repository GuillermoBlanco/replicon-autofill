/**
 * scripts/build-bookmarklet.js
 * Minifies bookmarklet/bookmarklet.js into dist/bookmarklet.min.js
 * and wraps it with "javascript:" prefix for easy copy-paste into a bookmark.
 */
const { minify } = require('terser');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../bookmarklet/bookmarklet.js'), 'utf8');

minify(src, { ecma: 2020, compress: true, mangle: true }).then(result => {
  const distDir = path.join(__dirname, '../dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);

  const minified = result.code;
  fs.writeFileSync(path.join(distDir, 'bookmarklet.min.js'), minified);

  const bookmarklet = 'javascript:' + encodeURIComponent(minified);
  fs.writeFileSync(path.join(distDir, 'bookmarklet.url.txt'), bookmarklet);

  console.log('✔ Built dist/bookmarklet.min.js');
  console.log('✔ Built dist/bookmarklet.url.txt  ← paste this as a bookmark URL');
}).catch(err => { console.error(err); process.exit(1); });
