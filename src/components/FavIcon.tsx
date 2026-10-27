/**
 * The "keep this song" icon: a heart for guests (saved on this device), a
 * thumbs-up for YouTube songs when signed in (Like on YouTube Music).
 */
import { Heart, ThumbsUp } from "lucide-react";
import { cn } from "@/utils/cn";
import type { Track } from "@/types";
import { useYtSession } from "@/services/yt/session";
import { likeApplies } from "@/services/yt/music";

export function FavIcon({ track, on, className }: { track?: Pick<Track, "id" | "source"> | null; on: boolean; className?: string }) {
  useYtSession(); // re-render on sign-in / account changes
  const Icon = track && likeApplies(track) ? ThumbsUp : Heart;
  return <Icon className={cn(className, on && "fill-current")} />;
}

/** Label for the button: "Like" / "Favourite". */
export function useFavLabel(track?: Pick<Track, "id" | "source"> | null): string {
  useYtSession();
  return track && likeApplies(track) ? "Like" : "Favourite";
}
