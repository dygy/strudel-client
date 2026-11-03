import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const nearestPackageDir = (file) => {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
  }
  return undefined;
};

/**
 * Bundling removes the license files of the packages inlined into the output, and their licenses ask
 * for the notices to stay with the code. This writes them next to the bundle.
 * @param {string} fileName the name of the file to emit
 * @returns {object} a rollup plugin
 */
export function thirdPartyNotices(fileName) {
  return {
    name: 'third-party-notices',
    generateBundle() {
      const packages = new Map();
      for (const id of this.getModuleIds()) {
        const file = id.split('?')[0].replace(/^\0/, '');
        if (!file.includes('node_modules') || !existsSync(file)) {
          continue;
        }
        const dir = nearestPackageDir(file);
        const manifest = dir && JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (manifest?.name && !packages.has(manifest.name)) {
          const licenseFile = readdirSync(dir).find((name) => /^(licen[cs]e|copying)/i.test(name));
          packages.set(manifest.name, {
            version: manifest.version,
            license: manifest.license,
            text: licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : '',
          });
        }
      }
      const sections = [...packages.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, { version, license, text }]) => `${name}@${version} (${license})\n\n${text}`);
      this.emitFile({
        type: 'asset',
        fileName,
        source: `Code bundled into this package, with its license notices.\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
      });
    },
  };
}
