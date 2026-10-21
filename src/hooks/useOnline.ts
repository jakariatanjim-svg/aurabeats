import { useSyncExternalStore } from "react";

const subscribe = (l: () => void) => {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
};
const get = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** false while the device has no network (the browser's own signal). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, get, () => true);
}
