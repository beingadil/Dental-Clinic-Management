/**
 * Optional Groq Whisper transcription (opt-in, off by default).
 * Records locally with MediaRecorder, sends the clip to Groq, returns text.
 * Requires `voice_cloud_transcription === true` and a stored Groq key.
 */
import { getGroqKeyForAudio } from './voiceGroq';

export interface RecordingHandle { stop: () => Promise<Blob>; cancel: () => void }

export async function recordClip(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  recorder.start();

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: mime }));
    };
  });

  return {
    stop: () => (recorder.state === 'inactive' ? done : (recorder.stop(), done)),
    cancel: () => { try { recorder.stop(); } catch { /* already stopped */ } stream.getTracks().forEach((t) => t.stop()); },
  };
}

export async function transcribeWithGroq(blob: Blob): Promise<string | null> {
  const key = getGroqKeyForAudio();
  if (!key) return null;
  const form = new FormData();
  form.append('file', blob, 'voice.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'text');
  form.append('temperature', '0');
  form.append('language', 'en');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
