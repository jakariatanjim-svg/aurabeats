import { useRef } from "react";

/**
 * A key that changes each time `on` turns true after the first render — put
 * it on an icon with a one-shot animation class so it plays on the change
 * (a tap on Like / Save / Subscribe), never on page load.
 */
export function useBump(on: boolean): number {
  const prev = useRef(on);
  const n = useRef(0);
  if (on !== prev.current) {
    if (on) n.current++;
    prev.current = on;
  }
  return n.current;
}
