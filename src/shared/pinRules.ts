/**
 * PIN lengths (1.0 readiness SEC-13, decision Q7). Every PIN is 4–12 digits (`userInputSchema`);
 * an OWNER's PIN set or changed from now on needs at least 6 — the owner's PIN guards the delete
 * of a business, the people and their rights, so it gets the longer floor. PINs already stored
 * keep working (a hash says nothing of its length, and sign-in never checks one). A person made
 * an owner gets a new PIN at that moment: the PIN they had was set under the 4-digit floor.
 */
import type { UserInput } from './schemas'

type Role = UserInput['role']

export const PIN_MIN_DIGITS = 4
export const OWNER_PIN_MIN_DIGITS = 6
export const PIN_MAX_DIGITS = 12

export type PinProblem = 'owner_pin_short' | 'owner_pin_needed'

/**
 * What is wrong with the PIN of a save, or null. `role` is the role the person will have after
 * the save; `wasOwner` whether they are an owner now (null = a new person). `pin` absent = keep
 * the stored PIN (an update).
 */
export function newPinProblem(pin: string | undefined, role: Role, wasOwner: boolean | null): PinProblem | null {
  if (role !== 'owner') return null
  if (pin) return pin.length < OWNER_PIN_MIN_DIGITS ? 'owner_pin_short' : null
  return wasOwner === false ? 'owner_pin_needed' : null
}
