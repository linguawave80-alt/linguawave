'use client';

import { useEffect, useRef } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import Icon from './Icon';
import { Avatar } from './ui';

type Props = {
  name: string;
  stream: MediaStream | null;
  local?: boolean;
  mirror?: boolean;
  micOn?: boolean;
  camOn?: boolean;
  sharing?: boolean;
  host?: boolean;
  signing?: boolean;
  connection?: string;
  speech?: string;
  sign?: string;
  videoRef?: MutableRefObject<HTMLVideoElement | null>;
  children?: ReactNode;
};

/**
 * One participant's tile: video, name bar, state badges and caption lines.
 * The <video> element is ALWAYS mounted (just hidden when the camera is off) because remote audio
 * plays through it. Local tiles are muted (no echo) and mirrored by CSS only; the stream itself is
 * never flipped, so other people see you the right way round.
 */
export default function VideoTile({
  name, stream, local = false, mirror = false, micOn = true, camOn = true, sharing = false,
  host = false, signing = false, connection = 'connected', speech = '', sign = '', videoRef, children,
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const setRef = (el: HTMLVideoElement | null) => { ref.current = el; if (videoRef) videoRef.current = el; };   // optional outer ref (sign engine reads the raw <video>)
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== (stream || null)) v.srcObject = stream || null;
  }, [stream]);

  const showVideo = !!stream && (camOn || sharing);
  const connecting = !local && (connection === 'new' || connection === 'connecting');
  const lost = !local && (connection === 'failed' || connection === 'disconnected');

  return (
    <figure className={`meet-tile ${local ? 'is-local' : ''} ${signing ? 'is-signing' : ''}`}>
      <video
        ref={setRef}
        autoPlay
        playsInline
        muted={local}
        className={`${mirror && !sharing ? 'mirror' : ''} ${sharing ? 'contain' : ''} ${showVideo ? '' : 'vid-off'}`}
        aria-label={`${local ? 'Your' : `${name}’s`} video`}
      />
      {!showVideo && (<div className="meet-tile-off"><Avatar name={name} size={72} /></div>)}
      {children}
      {connecting && <div className="meet-tile-status" role="status">Connecting…</div>}
      {lost && <div className="meet-tile-status bad" role="status">Connection lost</div>}

      <div className="meet-caps" aria-hidden="true">
        {sign && (
          <p className="cap cap-sign">
            <Icon name="hand" size={14} /><span className="sr-only">{name} signs: </span>{sign}
          </p>
        )}
        {speech && (<p className="cap cap-speech"><b>{name}</b> {speech}</p>)}
      </div>

      <figcaption className="meet-tile-bar">
        <span className="meet-tile-name">{local ? `${name} (You)` : name}</span>
        {host && <span className="meet-badge">Host</span>}
        {sharing && <span className="meet-badge"><Icon name="monitor" size={12} /> Presenting</span>}
        {signing && <span className="meet-badge sign"><Icon name="hand" size={12} /> Signing</span>}
        {!micOn && (
          <span className="meet-muted" title="Microphone off">
            <Icon name="mic-off" size={14} /><span className="sr-only">Microphone off</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
