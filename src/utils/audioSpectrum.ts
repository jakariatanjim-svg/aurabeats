/** Observe a copy of native playback, never reroute the audible element.
 * captureStream may refuse cross-origin media; that must not silence playback.
 */
export function spectrumReader(el: HTMLAudioElement) {
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let samples: Uint8Array<ArrayBuffer> | null = null;
  let attempted = false;
  const reset = () => {
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context) void context.close().catch(() => {});
    context = null; stream = null; source = null; analyser = null; samples = null;
    attempted = false;
  };
  return {
    reset,
    read(): Uint8Array<ArrayBuffer> | null {
      if (!attempted && el.readyState >= 2 && !el.paused) {
        attempted = true;
        try {
          const capture = (el as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream;
          if (!capture) return null;
          stream = capture.call(el);
          if (!stream.getAudioTracks().length) { reset(); attempted = true; return null; }
          context = new AudioContext();
          source = context.createMediaStreamSource(stream);
          analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.78;
          samples = new Uint8Array(analyser.frequencyBinCount);
          source.connect(analyser);
          void context.resume().catch(() => {});
        } catch { reset(); attempted = true; }
      }
      if (!analyser || !samples || context?.state !== "running") return null;
      analyser.getByteFrequencyData(samples);
      return samples;
    },
  };
}
