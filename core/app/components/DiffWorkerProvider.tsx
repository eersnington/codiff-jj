import { WorkerPoolContext } from '@pierre/diffs/react';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import { useSyncExternalStore, type ReactNode } from 'react';
import { maxWorkerThreads, workerHighlighterOptions } from '../../lib/code-view-options.ts';

const idleTimeoutMs = 30_000;
const subscribers = new Set<() => void>();
type DiffWorkerState =
  | { status: 'cold' }
  | { status: 'unavailable' }
  | { manager: WorkerPoolManager; release: () => void; status: 'ready' };
const coldPool: DiffWorkerState = { status: 'cold' };
let state: DiffWorkerState = coldPool;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

const getPool = () => state;
const getServerPool = () => coldPool;

const subscribeToPool = (notify: () => void) => {
  subscribers.add(notify);
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (state.status === 'cold' && typeof Worker !== 'undefined') {
    const workers: Array<Worker> = [];
    try {
      const poolSize = Math.min(
        maxWorkerThreads,
        Math.max(1, navigator.hardwareConcurrency || maxWorkerThreads),
      );
      for (let index = 0; index < poolSize; index++) {
        workers.push(
          new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
            type: 'module',
          }),
        );
      }
      const manager = new WorkerPoolManager(
        {
          poolSize,
          workerFactory: () => {
            const worker = workers.shift();
            if (!worker) {
              throw new Error('Diff worker pool exhausted during initialization.');
            }
            return worker;
          },
        },
        workerHighlighterOptions,
      );
      const release = () => {
        manager.terminate();
        for (const worker of workers) {
          worker.terminate();
        }
        workers.length = 0;
      };
      state = { manager, release, status: 'ready' };
      void manager.initialize().catch((error: unknown) => {
        if (state.status !== 'ready' || state.manager !== manager) {
          return;
        }
        release();
        state = { status: 'unavailable' };
        // oxlint-disable-next-line no-console -- Keep degraded highlighting diagnosable in developer tools.
        console.error('Diff worker initialization failed; using main-thread highlighting.', error);
        for (const subscriber of subscribers) {
          subscriber();
        }
      });
    } catch (error) {
      for (const worker of workers) {
        worker.terminate();
      }
      // oxlint-disable-next-line no-console -- Keep worker creation failures diagnosable in developer tools.
      console.error('Diff worker pool unavailable; using main-thread highlighting.', error);
    }
  }
  if (state.status === 'cold') {
    state = { status: 'unavailable' };
  }
  for (const subscriber of subscribers) {
    subscriber();
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      idleTimer = setTimeout(() => {
        if (state.status === 'ready') {
          state.release();
        }
        state = coldPool;
        idleTimer = undefined;
      }, idleTimeoutMs);
    }
  };
};

/** Starts workers after a viewer commits; warm reopens share the pool for 30 idle seconds. */
export function DiffWorkerProvider({ children }: { children: ReactNode }) {
  const pool = useSyncExternalStore(subscribeToPool, getPool, getServerPool);
  if (pool.status === 'cold') {
    return (
      <div className="code-view" role="status">
        Loading code…
      </div>
    );
  }
  return (
    <WorkerPoolContext key={pool.status} value={pool.status === 'ready' ? pool.manager : undefined}>
      {children}
    </WorkerPoolContext>
  );
}
