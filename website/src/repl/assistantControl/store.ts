/**
 * Allow assistant control (spec 018, functional 2.8). In memory on purpose: nothing here is written
 * anywhere, so a reload or a closed tab turns it off. Off by default.
 */
import { atom } from 'nanostores';

/** The user's switch, in this tab. */
export const assistantControlOn = atom(false);
/** The REPL here can be controlled at all. Never true in the embed or the admin view. */
export const assistantControlAvailable = atom(false);

export function setAssistantControl(on: boolean) {
  assistantControlOn.set(on && assistantControlAvailable.get());
}
