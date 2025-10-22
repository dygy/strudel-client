/*
cx.ts - Utility function for conditional CSS class names
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/repl/src/cx.js>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Conditionally joins CSS class names
 * @param classes - Array of class names (strings) or falsy values
 * @returns Combined class string with falsy values filtered out
 */
export default function cx(...classes: Array<string | undefined | null | false | 0 | ''>): string {
  return classes.filter(Boolean).join(' ');
}