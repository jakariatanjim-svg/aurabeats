#!/usr/bin/env bash
set -u
w() { echo "::warning::$*"; }
mkdir -p /tmp/tt/cls && cd /tmp/tt
javac -d cls "$GITHUB_WORKSPACE/native/android/Mp4Tagger.java" || { w "javac failed"; exit 1; }
ffmpeg -v error -f lavfi -i testsrc=duration=6:size=640x360:rate=25 -f lavfi -i sine=frequency=440:duration=6 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest v_end.mp4
ffmpeg -v error -i v_end.mp4 -c copy -movflags +faststart v_front.mp4
ffmpeg -v error -f lavfi -i sine=frequency=330:duration=8 -c:a aac a.m4a
ffmpeg -v error -f lavfi -i sine=frequency=330:duration=8 -c:a aac -movflags +faststart a_front.m4a
ffmpeg -v error -f lavfi -i testsrc=size=480x480 -frames:v 1 cover.jpg
for f in v_end.mp4 v_front.mp4 a.m4a a_front.m4a; do
  java -cp cls dev.pages.aurabeats.Mp4Tagger "$f" "t_$f" "Tum Hi Ho (টেস্ট)" "Arijit Singh" cover.jpg || { w "$f: tagger threw"; continue; }
  tags=$(ffprobe -v error -show_entries format_tags=title,artist -of compact=p=0 "t_$f")
  pic=$(ffprobe -v error -show_entries stream=codec_name:stream_disposition=attached_pic -of compact=p=0 "t_$f" | grep -c "attached_pic=1")
  errs=$(ffmpeg -v error -i "t_$f" -map 0:a -f null - 2>&1 | wc -l)
  a1=$(ffmpeg -v error -i "$f" -map 0:a -f md5 - 2>/dev/null); a2=$(ffmpeg -v error -i "t_$f" -map 0:a -f md5 - 2>/dev/null)
  v="n/a"
  if [[ $f == v* ]]; then v1=$(ffmpeg -v error -i "$f" -map 0:v:0 -f md5 - 2>/dev/null); v2=$(ffmpeg -v error -i "t_$f" -map 0:v:0 -f md5 - 2>/dev/null); [[ "$v1" == "$v2" ]] && v=same || v=DIFFERENT; fi
  ffmpeg -v error -i "t_$f" -map 0:v -map -0:V -frames:v 1 -y "pic_$f.jpg" 2>/dev/null
  same=$(cmp -s "pic_$f.jpg" cover.jpg && echo identical || echo "differs")
  w "$f -> tags[$tags] cover-streams=$pic coverbytes=$same decode-errors=$errs audio=$([[ "$a1" == "$a2" ]] && echo same || echo DIFFERENT) video=$v size $(stat -c%s "$f")->$(stat -c%s "t_$f")"
done
