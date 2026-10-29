import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPsd } from 'ag-psd';

export function inspectPsd(file) {
  const psd = readPsd(fs.readFileSync(file), {
    skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true,
  });
  const texts = [];
  function visit(layers = []) {
    for (const l of layers) {
      if (l.text) texts.push({
        name: l.name, bounds: { left: l.left, top: l.top, right: l.right, bottom: l.bottom },
        text: l.text.text, transform: l.text.transform,
        style: l.text.style, paragraphStyle: l.text.paragraphStyle,
        styleRuns: l.text.styleRuns, paragraphStyleRuns: l.text.paragraphStyleRuns,
      });
      visit(l.children);
    }
  }
  visit(psd.children);
  return { file: path.basename(file), width: psd.width, height: psd.height, texts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('Usage: node scripts/inspect-psd.mjs file.psd'); process.exitCode = 1; }
  else console.log(JSON.stringify(inspectPsd(process.argv[2]), null, 2));
}
