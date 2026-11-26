'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Owns the local camera/mic stream, device lists, and screen share.
// Every hardware device (camera light!) is released in stop() and on unmount.

const stopStream = (s: MediaStream | null | undefined) => s?.getTracks().forEach((t) => t.stop());

export type MediaErrorKey = 'denied' | 'notfound' | 'inuse' | 'other' | 'unsupported';

const classify = (err: any): MediaErrorKey => {
  const n = err?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'denied';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'notfound';
  if (n === 'NotReadableError' || n === 'AbortError') return 'inuse';
  return 'other';
};

export const MEDIA_ERRORS: Record<MediaErrorKey, string> = {
  denied: 'Camera and microphone access is blocked. Click the lock icon in the address bar, allow both, then reload.',
  notfound: 'No camera or microphone was found. You can still join to watch, listen and chat.',
  inuse: 'Your camera or microphone is being used by another app or tab. Close it and try again.',
  other: 'Could not start your camera or microphone.',
  unsupported: 'This browser cannot access a camera or microphone. Use a recent version of Chrome.',
};

export type MediaPick = { audio?: string; video?: string };

export default function useLocalMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<MediaErrorKey | null>(null);        // key of MEDIA_ERRORS, or null
  const [mic, setMicState] = useState(true);
  const [cam, setCamState] = useState(true);
  const [devices, setDevices] = useState<{ audio: MediaDeviceInfo[]; video: MediaDeviceInfo[] }>({ audio: [], video: [] });
  const [ids, setIds] = useState({ audio: '', video: '' });
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const micRef = useRef(true);
  const camRef = useRef(true);
  const idsRef = useRef(ids);
  const seq = useRef(0);                            // ignore results of superseded start() calls
  idsRef.current = ids;

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audio: list.filter((d) => d.kind === 'audioinput'),
        video: list.filter((d) => d.kind === 'videoinput'),
      });
    } catch { /* ignore */ }
  }, []);

  /** (Re)acquire camera + mic. Falls back to audio-only / video-only when one is missing. */
  const start = useCallback(async (pick: MediaPick = {}): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getUserMedia) { setError('unsupported'); return null; }
    const my = ++seq.current;
    stopStream(streamRef.current);
    streamRef.current = null;
    const audioId = pick.audio ?? idsRef.current.audio;
    const videoId = pick.video ?? idsRef.current.video;
    const audio: MediaTrackConstraints = {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      ...(audioId ? { deviceId: { exact: audioId } } : {}),
    };
    const video: MediaTrackConstraints = {
      width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 },
      ...(videoId ? { deviceId: { exact: videoId } } : {}),
    };
    let s: MediaStream | null = null;
    let err: unknown = null;
    for (const c of [{ audio, video }, { audio, video: false }, { audio: false, video }] as MediaStreamConstraints[]) {
      try { s = await navigator.mediaDevices.getUserMedia(c); err = null; break; }
      catch (e) {
        err = e;
        if (classify(e) === 'denied') break;        // no point trying the other combinations
      }
    }
    if (my !== seq.current) { stopStream(s); return null; }   // superseded, stopped or unmounted
    if (!s) { setStream(null); setError(classify(err)); refreshDevices(); return null; }
    s.getAudioTracks().forEach((t) => { t.enabled = micRef.current; });
    s.getVideoTracks().forEach((t) => { t.enabled = camRef.current; t.contentHint = 'motion'; });
    streamRef.current = s;
    setStream(s);
    setError(s.getAudioTracks().length && s.getVideoTracks().length ? null : 'notfound');
    setIds({
      audio: s.getAudioTracks()[0]?.getSettings().deviceId || '',
      video: s.getVideoTracks()[0]?.getSettings().deviceId || '',
    });
    refreshDevices();                                // labels only appear after permission is granted
    return s;
  }, [refreshDevices]);

  const stopShare = useCallback(() => {
    screenRef.current?.stop();
    screenRef.current = null;
    setScreenTrack(null);
  }, []);

  /** Release every device. Safe to call repeatedly. */
  const stop = useCallback(() => {
    seq.current++;
    stopShare();
    stopStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, [stopShare]);

  const setMic = useCallback((on: boolean) => {
    micRef.current = on; setMicState(on);
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
  }, []);
  const setCam = useCallback((on: boolean) => {
    camRef.current = on; setCamState(on);
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = on; });
  }, []);

  /** Returns the screen video track, or null if the user cancelled / it is unsupported. */
  const startShare = useCallback(async (): Promise<MediaStreamTrack | null> => {
    if (!navigator.mediaDevices?.getDisplayMedia) return null;
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 15 } }, audio: false });
      const track = ds.getVideoTracks()[0];
      if (!track) return null;
      track.contentHint = 'detail';
      screenRef.current = track;
      setScreenTrack(track);
      return track;
    } catch { return null; }
  }, []);

  useEffect(() => {
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refreshDevices);
    return () => md?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  // Unmount: release camera, mic and screen capture.
  useEffect(() => () => {
    seq.current++;
    screenRef.current?.stop();
    stopStream(streamRef.current);
  }, []);

  return { stream, error, mic, cam, setMic, setCam, devices, ids, start, stop, screenTrack, startShare, stopShare };
}

export type LocalMedia = ReturnType<typeof useLocalMedia>;
