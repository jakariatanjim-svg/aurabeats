/**
 * In-app volume controls are a computer thing: phones (the app, or a phone
 * browser) use their own volume buttons, like the YouTube / Spotify apps.
 * Where there are no controls the app's volume stays at 100 %.
 */
import { isNative } from "@/services/video/net";

export const showVolumeUi: boolean =
  !isNative && typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches !== false;
