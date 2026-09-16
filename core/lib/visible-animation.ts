/** React ref callback: pause status animations offscreen or in a hidden document, and clean up on detach. */
export function observeVisibleAnimation(
  element: HTMLElement | SVGElement | null,
): (() => void) | undefined {
  if (!element) {
    return;
  }
  const document = element.ownerDocument;
  let visible = typeof IntersectionObserver === 'undefined';
  const update = () => {
    element.style.animationPlayState = visible && !document.hidden ? 'running' : 'paused';
  };
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          update();
        });
  observer?.observe(element);
  document.addEventListener('visibilitychange', update);
  update();
  return () => {
    observer?.disconnect();
    document.removeEventListener('visibilitychange', update);
    element.style.removeProperty('animation-play-state');
  };
}
