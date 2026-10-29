/** Formats OpenAI transcribes, best first: WebM/Opus (Chrome, Firefox, Edge), then MP4 (Safari). */
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];
/** Speech needs little: about 240 KB per minute where the browser honours it. */
const BITS_PER_SECOND = 32_000;

export function recordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** True when this browser can record and the embedding page's policy lets the iframe use the microphone. */
export function canRecord(): boolean {
  if (!navigator.mediaDevices?.getUserMedia || !recordingMimeType()) return false;
  // Not in Safari; there a blocked microphone surfaces as an error on first use.
  const policy = (
    document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }
  ).featurePolicy;
  return policy?.allowsFeature('microphone') ?? true;
}

export class MicrophoneError extends Error {
  readonly reason: 'blocked' | 'missing' | 'failed';

  constructor(reason: 'blocked' | 'missing' | 'failed', options?: ErrorOptions) {
    super(`Microphone ${reason}`, options);
    this.reason = reason;
  }
}

export interface Recording {
  /** Current loudness from 0 to 1, for the level meter. */
  level(): number;
  /** Stops recording, releases the microphone and returns the audio. */
  stop(): Promise<Blob>;
  /** Stops recording and throws the audio away. */
  cancel(): void;
}

/** Asks for the microphone and starts recording. Throws {@link MicrophoneError}. */
export async function startRecording(): Promise<Recording> {
  const mimeType = recordingMimeType();
  if (!mimeType) throw new MicrophoneError('failed');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicrophoneError('blocked', { cause: error });
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new MicrophoneError('missing', { cause: error });
    }
    throw new MicrophoneError('failed', { cause: error });
  }

  const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: BITS_PER_SECOND });
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve) =>
    recorder.addEventListener('stop', () => resolve(), { once: true }),
  );
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const release = (): void => {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };
  const halt = (): void => {
    if (recorder.state !== 'inactive') recorder.stop();
  };
  recorder.start(250);

  return {
    level() {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }
      // Speech sits well below full scale; amplify so the meter visibly moves.
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
    async stop() {
      halt();
      await stopped;
      release();
      return new Blob(chunks, { type: mimeType.split(';')[0] ?? mimeType });
    },
    cancel() {
      halt();
      release();
    },
  };
}
