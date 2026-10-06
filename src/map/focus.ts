/** A request to select and center something on a map. `n` makes repeated jumps to the same id count. */
export type Focus = { id: string; n: number };

let counter = 0;
export const focusOn = (id: string): Focus => ({ id, n: ++counter });
