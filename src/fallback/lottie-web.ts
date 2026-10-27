import type { FallbackHandle, FallbackRenderer } from '../player/index';

export const lottieWebFallback: FallbackRenderer = async (container, source, options) => {
  const { default: lottie } = await import('lottie-web');
  const anim = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: options.loop,
    autoplay: options.autoplay,
    animationData: source,
  });
  anim.setSpeed(options.speed);
  const handle: FallbackHandle = {
    play: () => anim.play(),
    pause: () => anim.pause(),
    stop: () => anim.stop(),
    seek: (frame) => (anim.isPaused ? anim.goToAndStop(frame, true) : anim.goToAndPlay(frame, true)),
    setSpeed: (speed) => anim.setSpeed(speed),
    setDirection: (direction) => anim.setDirection(direction),
    destroy: () => anim.destroy(),
  };
  return handle;
};
