import { type CSSProperties, createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { type LightiePlayerElement, TAG_NAME } from '../element/index';
import type { FallbackRenderer, Fit } from '../player/index';
import type { LightieAnimation } from '../types';

export type { LightiePlayerElement } from '../element/index';

export interface LightieProps {
  src?: string;
  animation?: LightieAnimation | object;
  loop?: boolean | number;
  autoplay?: boolean;
  speed?: number;
  fit?: Fit;
  fallback?: FallbackRenderer;
  id?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  'aria-label'?: string;
  onReady?: () => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
}

export const Lightie = forwardRef<LightiePlayerElement | null, LightieProps>(function Lightie(props, ref) {
  const { animation, fallback, onReady, onComplete, onError, loop, autoplay, speed, ...attributes } = props;
  const element = useRef<LightiePlayerElement | null>(null);
  const handlers = useRef({ onReady, onComplete, onError });
  handlers.current = { onReady, onComplete, onError };

  useImperativeHandle(ref, () => element.current as LightiePlayerElement, []);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const ready = () => handlers.current.onReady?.();
    const complete = () => handlers.current.onComplete?.();
    const error = (event: Event) => handlers.current.onError?.((event as CustomEvent).detail);
    el.addEventListener('ready', ready);
    el.addEventListener('complete', complete);
    el.addEventListener('error', error);
    return () => {
      el.removeEventListener('ready', ready);
      el.removeEventListener('complete', complete);
      el.removeEventListener('error', error);
    };
  }, []);

  useEffect(() => {
    const el = element.current;
    if (el) el.fallback = fallback;
  }, [fallback]);

  useEffect(() => {
    const el = element.current;
    if (el && animation !== undefined) el.animation = animation;
  }, [animation]);

  return createElement(TAG_NAME, {
    ...attributes,
    ref: element,
    loop: loop === undefined || loop === false ? undefined : String(loop === true ? '' : loop),
    autoplay: autoplay ? '' : undefined,
    speed: speed === undefined ? undefined : String(speed),
  });
});
