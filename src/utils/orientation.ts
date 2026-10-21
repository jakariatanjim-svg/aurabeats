/**
 * Android app screen orientation, like the YouTube app: on phones the app
 * stays upright (tilting the phone doesn't flip the screen) and only full
 * screen video goes sideways. "Rotate for full screen" (Settings → Video,
 * off by default) lets the app follow the phone instead.
 */
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { isNative } from "@/services/video/net";
import { getVideoSettings } from "@/services/video/settings";

const isPhone = () => Math.min(screen.width, screen.height) < 600;

/** The orientation outside full screen video. */
export async function baseOrientation(): Promise<void> {
  if (!isNative) return;
  try {
    if (isPhone() && !getVideoSettings().rotateFullscreen) await ScreenOrientation.lock({ orientation: "portrait" });
    else await ScreenOrientation.unlock();
  } catch {
    /* plugin missing (older APK) */
  }
}
