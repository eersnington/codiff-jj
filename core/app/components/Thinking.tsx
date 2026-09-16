import { observeVisibleAnimation } from '../../lib/visible-animation.ts';

export function Thinking() {
  return (
    <div
      className="review-source-loading loading pulse italic"
      ref={observeVisibleAnimation}
      role="status"
    >
      Thinking…
    </div>
  );
}
