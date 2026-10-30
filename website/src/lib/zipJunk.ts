/**
 * Entries a ZIP carries that are not the user's files: macOS Finder's `__MACOSX/` AppleDouble
 * copies (`._name`, binary, often matching *.js) and `.DS_Store`.
 */
export function isZipJunk(name: string): boolean {
  return /(^|\/)__MACOSX\//.test(name) || /(^|\/)\._/.test(name) || /(^|\/)\.DS_Store$/.test(name);
}
