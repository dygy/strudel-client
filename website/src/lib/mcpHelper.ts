/**
 * The local helper's package, in one place: the settings panel, the setup page and the Worker's answers
 * only offer it while this says it's there, because a package nobody owns yet could be anyone's.
 * Flip it when the package is on npm.
 */
export const HELPER_PUBLISHED = false;
export const HELPER_PACKAGE = 'strudel_mcp_js';
export const HELPER_COMMAND = `claude mcp add strudel-local -- npx -y ${HELPER_PACKAGE}`;
