import { useEffect, useState } from 'react';
import { observeVisibleAnimation } from '../../../lib/visible-animation.ts';
import type { WalkthroughProgressPhase } from '../../../types.ts';

export const walkthroughResponseLabels = [
  'Building walkthrough…',
  'Composing walkthrough…',
  'Writing walkthrough…',
  'Assembling walkthrough…',
  'Creating walkthrough…',
  'Producing walkthrough…',
] as const;

export const nextWalkthroughResponseLabelIndex = (current: number) =>
  (current + 1) % walkthroughResponseLabels.length;

const TIMER_THRESHOLD_SECONDS = 3;

export function WalkthroughProgress({
  phase,
  responseLabelIndex,
  stageRevision,
}: {
  phase: WalkthroughProgressPhase | null;
  responseLabelIndex: number;
  stageRevision: number;
}) {
  const [timerState, setTimerState] = useState({ elapsedSeconds: 0, stageRevision });

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setTimerState({
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        stageRevision,
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [stageRevision]);

  const elapsedSeconds = timerState.stageRevision === stageRevision ? timerState.elapsedSeconds : 0;
  const showTimer = elapsedSeconds >= TIMER_THRESHOLD_SECONDS;
  const label =
    phase === 'agent-generation'
      ? 'Analyzing changes…'
      : phase === 'response-received'
        ? walkthroughResponseLabels[Math.abs(responseLabelIndex) % walkthroughResponseLabels.length]
        : 'Generating walkthrough…';

  return (
    <span
      aria-live="polite"
      className="walkthrough-progress"
      ref={observeVisibleAnimation}
      role="status"
    >
      <span className="walkthrough-progress-label">{label}</span>
      <span
        aria-hidden={!showTimer}
        className={`walkthrough-progress-timer${showTimer ? ' visible' : ''}`}
      >
        {showTimer ? `${elapsedSeconds}s` : '0s'}
      </span>
    </span>
  );
}
