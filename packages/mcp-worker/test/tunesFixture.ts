/** The site's example tunes, as text: a corpus of real Strudel for the check to find nothing wrong in. */
import * as all from '../../../website/src/repl/tunes';

export const tunes = Object.fromEntries(
  Object.entries(all).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
