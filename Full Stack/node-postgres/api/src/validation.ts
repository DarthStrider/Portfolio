/** Input rules for the task API, kept free of Express so they can be unit-tested directly. */

export const MAX_TITLE = 200;

/** A route id: a positive whole number, or undefined. */
export function parseId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 ? id : undefined;
}

/** A title must be a string with something other than spaces in it, at most 200 characters. */
export function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TITLE;
}
