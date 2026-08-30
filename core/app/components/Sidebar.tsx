import { useCallback, useEffect, useMemo, useRef } from 'react';
import { matchesShortcut } from '../../config/keymap.ts';
import type { CodiffKeymap } from '../../config/types.ts';
import type {
  DiffLineCount,
  PullRequestSource,
  SidebarMode,
  WalkthroughError,
} from '../../lib/app-types.ts';
import {
  formatLineCountNumber,
  getDiffLineCount,
  getDiffLineCountTitle,
  getTotalDiffLineCount,
} from '../../lib/diff.ts';
import { isNativeInputTarget } from '../../lib/keyboard.ts';
import { getShortRef, getSourceKey } from '../../lib/source.ts';
import type {
  ChangedFile,
  HistoryDiffStat,
  HistoryEntry,
  NarrativeWalkthrough,
  ReviewSource,
} from '../../types.ts';
import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { ReviewFileTree } from './FileTree.tsx';
import { NarrativeSidebar } from './walkthrough/NarrativeSidebar.tsx';
import type { NarrativeNavigation } from './walkthrough/useNarrativeNavigation.ts';
import { WalkthroughProgress } from './walkthrough/WalkthroughProgress.tsx';

export function Sidebar({
  branchSource,
  commitFiles,
  commitViewOpen,
  currentSource,
  files,
  historyEntries,
  historyHasMore,
  historyLoading,
  historyStackDiff,
  historyStackRange,
  historyWorkingCopyDiff,
  keymap,
  mode,
  narrativeNavigation,
  narrativeWalkthrough,
  onActivatePath,
  onLoadMoreHistory,
  onSearchQueryChange,
  onSelectSource,
  onShareWalkthrough,
  onToggleCommitView,
  pullRequestSource,
  reloadDeltaPaths,
  searchQuery,
  selectedPath,
  shareWalkthroughDisabled,
  showWhitespace,
  viewed,
  walkthroughError,
  walkthroughLoading,
  walkthroughProgress,
}: {
  branchSource: Extract<ReviewSource, { type: 'branch-diff' }> | null;
  commitFiles: ReadonlyArray<ChangedFile>;
  commitViewOpen: boolean;
  currentSource: ReviewSource;
  files: ReadonlyArray<ChangedFile>;
  historyEntries: ReadonlyArray<HistoryEntry>;
  historyHasMore: boolean;
  historyLoading: boolean;
  historyStackDiff: HistoryDiffStat | null;
  historyStackRange: { base: string; head: string } | null;
  historyWorkingCopyDiff: HistoryDiffStat | null;
  keymap: CodiffKeymap;
  mode: SidebarMode;
  narrativeNavigation: NarrativeNavigation;
  narrativeWalkthrough: NarrativeWalkthrough | null;
  onActivatePath: (path: string) => void;
  onLoadMoreHistory: () => void;
  onSearchQueryChange: (query: string) => void;
  onSelectSource: (source: ReviewSource) => void;
  onShareWalkthrough?: () => void;
  onToggleCommitView: () => void;
  pullRequestSource: PullRequestSource | null;
  reloadDeltaPaths: ReadonlySet<string>;
  searchQuery: string;
  selectedPath: string | null;
  shareWalkthroughDisabled?: boolean;
  showWhitespace: boolean;
  viewed: Record<string, string>;
  walkthroughError: WalkthroughError | null;
  walkthroughLoading: boolean;
  walkthroughProgress: {
    phase: import('../../types.ts').WalkthroughProgressPhase | null;
    responseLabelIndex: number;
    stageRevision: number;
  };
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lineCountsByPath = useMemo(
    () => new Map(files.map((file) => [file.path, getDiffLineCount(file, showWhitespace)])),
    [files, showWhitespace],
  );
  const totalLineCount = useMemo(
    () => getTotalDiffLineCount(lineCountsByPath.values()),
    [lineCountsByPath],
  );
  const showTotalLineCount = mode !== 'history' && totalLineCount.countable;
  const showCommitButton =
    mode === 'tree' && currentSource.type === 'working-tree' && commitFiles.length > 0;
  const showFooter = showTotalLineCount || showCommitButton;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isNativeInputTarget(event.target) && matchesShortcut(event, keymap, 'fileFilter')) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keymap]);

  return (
    <>
      <div className="sidebar-search-row">
        <input
          aria-label="Filter changed files"
          className="sidebar-search"
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          placeholder={mode === 'history' ? 'Filter history' : 'Filter files'}
          ref={searchInputRef}
          spellCheck={false}
          type="search"
          value={searchQuery}
        />
      </div>
      {mode === 'history' ? (
        <HistorySidebar
          branchSource={branchSource}
          currentSource={currentSource}
          entries={historyEntries}
          hasMore={historyHasMore}
          loading={historyLoading}
          onLoadMore={onLoadMoreHistory}
          onSelectSource={onSelectSource}
          pullRequestSource={pullRequestSource}
          searchQuery={searchQuery}
          stackDiff={historyStackDiff}
          stackRange={historyStackRange}
          workingCopyDiff={historyWorkingCopyDiff}
        />
      ) : mode === 'walkthrough' && narrativeWalkthrough ? (
        <NarrativeSidebar
          files={commitFiles}
          navigation={narrativeNavigation}
          onShareWalkthrough={onShareWalkthrough}
          shareWalkthroughDisabled={shareWalkthroughDisabled}
          showWhitespace={showWhitespace}
          walkthrough={narrativeWalkthrough}
        />
      ) : mode === 'walkthrough' ? (
        <>
          {walkthroughLoading ? (
            <div className="sidebar-walkthrough-status-shell">
              <div className="sidebar-walkthrough-status codex">
                <WalkthroughProgress
                  phase={walkthroughProgress.phase}
                  responseLabelIndex={walkthroughProgress.responseLabelIndex}
                  stageRevision={walkthroughProgress.stageRevision}
                />
              </div>
            </div>
          ) : walkthroughError ? (
            <div className="sidebar-walkthrough-status" title={walkthroughError.reason}>
              <strong>Walkthrough unavailable</strong>
              <span>{walkthroughError.reason}</span>
            </div>
          ) : null}
        </>
      ) : (
        <ReviewFileTree
          files={files}
          onActivatePath={onActivatePath}
          reloadDeltaPaths={reloadDeltaPaths}
          scrollSelectedPathIntoView
          selectedPath={selectedPath}
          showWhitespace={showWhitespace}
          viewed={viewed}
        />
      )}
      {showFooter ? (
        <div className="sidebar-total-row">
          <span className="sidebar-total-summary">
            {showTotalLineCount ? (
              <>
                <span>Total:</span>
                <DiffLineCountBadge
                  ariaLabelPrefix="Total change"
                  className="sidebar-total-line-count"
                  lineCount={totalLineCount}
                />
              </>
            ) : null}
          </span>
          {showCommitButton ? (
            <Button
              aria-label={commitViewOpen ? 'Show file tree' : 'Open commit view'}
              className="sidebar-commit-button"
              onClick={onToggleCommitView}
              type="button"
            >
              {commitViewOpen ? 'Tree' : 'Commit'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const shortDate = (timestamp: number) => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }
  return `${Math.floor(months / 12)}y ago`;
};

const formatHistoryDiff = (diff?: HistoryDiffStat | null) =>
  diff && (diff.files || diff.additions || diff.deletions)
    ? `${diff.files}f +${diff.additions} -${diff.deletions}`
    : null;

function HistoryDiffStatLabel({ diff }: { diff: HistoryDiffStat }) {
  return (
    <span className="history-entry-diff">
      <span className="history-entry-diff-files">{diff.files}f</span>
      <span className="history-entry-diff-add">+{diff.additions}</span>
      <span className="history-entry-diff-del">-{diff.deletions}</span>
    </span>
  );
}

function HistorySidebar({
  branchSource,
  currentSource,
  entries,
  hasMore,
  loading,
  onLoadMore,
  onSelectSource,
  pullRequestSource,
  searchQuery,
  stackDiff,
  stackRange,
  workingCopyDiff,
}: {
  branchSource: Extract<ReviewSource, { type: 'branch-diff' }> | null;
  currentSource: ReviewSource;
  entries: ReadonlyArray<HistoryEntry>;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onSelectSource: (source: ReviewSource) => void;
  pullRequestSource: PullRequestSource | null;
  searchQuery: string;
  stackDiff: HistoryDiffStat | null;
  stackRange: { base: string; head: string } | null;
  workingCopyDiff: HistoryDiffStat | null;
}) {
  const currentSourceKey = getSourceKey(currentSource);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const commitRows = entries.map((entry) => ({
      author: entry.author,
      committedAt: entry.committedAt,
      diff: entry.diff,
      gravatarUrl: entry.gravatarUrl,
      key: entry.stackRole === 'working-copy' ? 'working-tree' : `commit:${entry.ref}`,
      kind: 'entry' as const,
      marker:
        entry.stackRole === 'working-copy'
          ? '@'
          : entry.stackRole === 'trunk'
            ? '◆'
            : entry.scope === 'stack'
              ? '○'
              : null,
      ref: entry.ref,
      scope: entry.scope,
      source: (entry.stackRole === 'working-copy'
        ? { type: 'working-tree' }
        : { ref: entry.ref, type: 'commit' }) satisfies ReviewSource,
      stackRole: entry.stackRole,
      subject: entry.workspace
        ? `${entry.workspace}: ${entry.subject || 'Working copy'}`
        : entry.subject || (entry.stackRole === 'working-copy' ? 'Working copy' : ''),
      workspace: entry.workspace,
    }));
    const matchesQuery = (row: (typeof commitRows)[number]) =>
      !normalizedQuery ||
      row.subject.toLowerCase().includes(normalizedQuery) ||
      row.ref.toLowerCase().includes(normalizedQuery) ||
      row.author.toLowerCase().includes(normalizedQuery) ||
      (row.workspace != null && row.workspace.toLowerCase().includes(normalizedQuery));

    if (pullRequestSource) {
      const hasScopedRows = commitRows.some((row) => row.scope != null);
      const pullRequestRows = commitRows
        .filter((row) => (hasScopedRows ? row.scope === 'pull-request' : row.scope == null))
        .filter(matchesQuery);
      const baseRows = hasScopedRows
        ? commitRows.filter((row) => row.scope === 'base').filter(matchesQuery)
        : [];
      return [
        !normalizedQuery
          ? {
              author: null,
              committedAt: null,
              gravatarUrl: undefined,
              key: getSourceKey(pullRequestSource),
              kind: 'entry' as const,
              ref: pullRequestSource.number ? `PR #${pullRequestSource.number}` : 'PR',
              source: pullRequestSource satisfies ReviewSource,
              subject: pullRequestSource.title || 'Pull Request',
            }
          : null,
        {
          key: 'history-section:pull-request',
          kind: 'section' as const,
          label: hasScopedRows ? 'Review commits' : 'Branch history',
        },
        ...pullRequestRows,
        { key: 'history-section:base', kind: 'section' as const, label: 'Base history' },
        ...baseRows,
      ].filter((row): row is NonNullable<typeof row> => row != null);
    }

    if (branchSource) {
      const localRows = commitRows.filter(matchesQuery);
      return [
        !normalizedQuery
          ? {
              key: 'history-section:review-scope',
              kind: 'section' as const,
              label: 'Review scope',
            }
          : null,
        !normalizedQuery
          ? {
              author: null,
              committedAt: null,
              gravatarUrl: undefined,
              key: 'working-tree',
              kind: 'entry' as const,
              ref: '',
              source: { type: 'working-tree' } satisfies ReviewSource,
              subject: 'Uncommitted changes',
            }
          : null,
        !normalizedQuery
          ? {
              author: null,
              committedAt: null,
              gravatarUrl: undefined,
              key: getSourceKey({
                baseRef: branchSource.baseRef,
                headRef: branchSource.headRef,
                ref: branchSource.ref,
                type: 'branch-working-tree',
              }),
              kind: 'entry' as const,
              ref: 'branch+',
              source: {
                baseRef: branchSource.baseRef,
                headRef: branchSource.headRef,
                ref: branchSource.ref,
                type: 'branch-working-tree',
              } satisfies ReviewSource,
              subject: `All changes vs ${branchSource.ref}`,
            }
          : null,
        !normalizedQuery
          ? {
              author: null,
              committedAt: null,
              gravatarUrl: undefined,
              key: getSourceKey(branchSource),
              kind: 'entry' as const,
              ref: 'branch',
              source: branchSource satisfies ReviewSource,
              subject: `Committed only vs ${branchSource.ref}`,
            }
          : null,
        localRows.length > 0
          ? {
              key: 'history-section:branch',
              kind: 'section' as const,
              label: 'Branch history',
            }
          : null,
        ...localRows,
      ].filter((row): row is NonNullable<typeof row> => row != null);
    }

    const stackMemberRows = commitRows
      .filter((row) => row.scope === 'stack' && row.stackRole !== 'trunk')
      .filter(matchesQuery);
    const trunkRow = commitRows.find((row) => row.stackRole === 'trunk');
    const stackRows = [
      ...stackMemberRows,
      trunkRow && matchesQuery(trunkRow) ? trunkRow : null,
    ].filter((row): row is NonNullable<typeof row> => row != null);
    const workspaceRows = commitRows
      .filter((row) => row.scope === 'workspace')
      .filter(matchesQuery);
    const localRows = commitRows
      .filter((row) => row.scope !== 'stack' && row.scope !== 'workspace')
      .filter(matchesQuery);
    const stackSource = stackRange
      ? ({
          base: stackRange.base,
          head: stackRange.head,
          symmetric: false,
          type: 'range',
        } satisfies ReviewSource)
      : null;
    const hasWorkingCopyStackRow = stackRows.some((row) => row.stackRole === 'working-copy');
    const displayedStackRows = stackRows.map((row) =>
      row.stackRole === 'working-copy' && workingCopyDiff ? { ...row, diff: workingCopyDiff } : row,
    );
    return [
      !normalizedQuery && !hasWorkingCopyStackRow
        ? {
            author: null,
            committedAt: null,
            diff: workingCopyDiff ?? undefined,
            gravatarUrl: undefined,
            key: 'working-tree',
            kind: 'entry' as const,
            marker: null,
            ref: '',
            source: { type: 'working-tree' } satisfies ReviewSource,
            subject: 'Uncommitted changes',
          }
        : null,
      !normalizedQuery && stackSource
        ? {
            author: null,
            committedAt: null,
            diff: stackDiff ?? undefined,
            gravatarUrl: undefined,
            key: getSourceKey(stackSource),
            kind: 'entry' as const,
            marker: null,
            ref: 'stack',
            source: stackSource,
            subject: 'Stack vs trunk',
          }
        : null,
      displayedStackRows.length > 0
        ? { key: 'history-section:stack', kind: 'section' as const, label: 'Stack' }
        : null,
      ...displayedStackRows,
      workspaceRows.length > 0
        ? { key: 'history-section:workspaces', kind: 'section' as const, label: 'Workspaces' }
        : null,
      ...workspaceRows,
      localRows.length > 0
        ? { key: 'history-section:history', kind: 'section' as const, label: 'History' }
        : null,
      ...localRows,
    ].filter((row): row is NonNullable<typeof row> => row != null);
  }, [
    branchSource,
    entries,
    normalizedQuery,
    pullRequestSource,
    stackDiff,
    stackRange,
    workingCopyDiff,
  ]);
  const maybeLoadMore = useCallback(() => {
    const element = listRef.current;
    if (!element || loading || !hasMore || normalizedQuery) {
      return;
    }

    if (element.scrollHeight - element.scrollTop - element.clientHeight < 120) {
      onLoadMore();
    }
  }, [hasMore, loading, normalizedQuery, onLoadMore]);

  return (
    <div className="history-list" onScroll={maybeLoadMore} ref={listRef}>
      {rows.map((row) => {
        if (row.kind === 'section') {
          return (
            <div className="history-section" key={row.key}>
              {row.label}
            </div>
          );
        }

        const selected = row.key === currentSourceKey;
        const hasMetadata = Boolean(row.author && row.committedAt);
        const diffLabel = formatHistoryDiff('diff' in row ? row.diff : null);
        const showMeta = hasMetadata || Boolean(diffLabel);
        return (
          <button
            className={`history-entry${selected ? ' selected' : ''}${showMeta ? ' with-metadata' : ''}`}
            key={row.key}
            onClick={() => onSelectSource(row.source)}
            title={diffLabel ? `${row.subject} (${diffLabel})` : row.subject}
            type="button"
          >
            <span className="history-entry-ref">
              {'marker' in row && row.marker ? (
                <span className="history-entry-marker">{row.marker}</span>
              ) : null}
              {row.source.type === 'commit'
                ? getShortRef(row.source.ref)
                : row.source.type === 'working-tree' && row.ref
                  ? getShortRef(row.ref)
                  : row.source.type === 'pull-request' ||
                      row.source.type === 'branch-diff' ||
                      row.source.type === 'branch-working-tree' ||
                      row.source.type === 'range'
                    ? row.ref
                    : 'local'}
            </span>
            <span className="history-entry-subject">{row.subject}</span>
            {showMeta ? (
              <span className="history-entry-meta">
                {hasMetadata ? (
                  <span className="history-entry-author">
                    <Avatar name={row.author || '?'} size="small" url={row.gravatarUrl} />
                    <span>{row.author}</span>
                  </span>
                ) : (
                  <span />
                )}
                <span className="history-entry-meta-end">
                  {diffLabel && 'diff' in row && row.diff ? (
                    <HistoryDiffStatLabel diff={row.diff} />
                  ) : null}
                  {hasMetadata ? <span>{shortDate(row.committedAt || 0)}</span> : null}
                </span>
              </span>
            ) : null}
          </button>
        );
      })}
      {loading ? (
        <div className="history-loading">
          <span>Loading history…</span>
        </div>
      ) : null}
    </div>
  );
}

export function DiffLineCountBadge({
  ariaLabelPrefix,
  className = 'codiff-line-count',
  lineCount,
}: {
  ariaLabelPrefix?: string;
  className?: string;
  lineCount: DiffLineCount;
}) {
  if (!lineCount.countable) {
    return null;
  }

  const title = getDiffLineCountTitle(lineCount);

  return (
    <span
      aria-label={ariaLabelPrefix ? `${ariaLabelPrefix}: ${title}` : title}
      className={className}
      title={ariaLabelPrefix ? `${ariaLabelPrefix}: ${title}` : title}
    >
      <span className="codiff-line-count-added">+{formatLineCountNumber(lineCount.additions)}</span>
      <span className="codiff-line-count-deleted">
        -{formatLineCountNumber(lineCount.deletions)}
      </span>
    </span>
  );
}
