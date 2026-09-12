import { renderMarkdown } from '@bookclaw/shared';
import { GatePanel } from './GatePanel.js';
import { VersionTrail } from './VersionTrail.js';
import { chapterNumber, type BookItem, type RunState, type Version } from './types.js';
import styles from './ReadingPane.module.css';
import btn from './buttons.module.css';

/**
 * The reading pane already prints the item's title, so a body that opens with
 * its own markdown heading would print it twice. Drop that one leading heading
 * line and nothing else — the rest of the file renders as written.
 */
function withoutLeadingHeading(md: string): string {
  return md.replace(/^\s*#{1,6}[^\n]*\n+/, '');
}

function Head({ eyebrow, title, scene }: { eyebrow: string; title: string; scene?: string }) {
  return (
    <div className={styles.inner}>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <h1 className={styles.ch}>{title}</h1>
      {scene && <p className={styles.sceneline}>{scene}</p>}
      <div className={styles.rule} />
    </div>
  );
}

function CoverArtboard({ title, author, caption }: { title: string; author?: string; caption: string }) {
  return (
    <div className={styles.coverwrap}>
      <div className={styles.cover}>
        <div className={styles.t}>{title}</div>
        {author && <div className={styles.a}>{author}</div>}
        <div className={styles.ph}>{caption}</div>
      </div>
    </div>
  );
}

/**
 * The typeset body (design §2). Branches on `kind` — prose, document, cover —
 * never on "is this a chapter", and hosts the gate panel plus the two empty
 * states: a chapter the pipeline hasn't reached, and an item no skill has
 * written yet.
 */
export function ReadingPane({
  item, version, body, run, groupLabel, bookTitle, authorName, loading, error,
  onSelectItem, onSelectVersion, onGateResolved,
}: {
  item: BookItem | null;
  version: Version | null;
  body: string;
  run: RunState;
  groupLabel: string;
  bookTitle: string;
  authorName?: string;
  loading: boolean;
  error: string | null;
  onSelectItem: (id: string) => void;
  onSelectVersion: (versionId: string) => void;
  onGateResolved: () => void;
}) {
  if (!item) {
    return (
      <div className={styles.read}>
        <div className={styles.note}>
          {loading ? 'Loading…' : error ? <><b className={styles.bad}>Couldn't open this book</b> — {error}</> : 'Pick something from the contents to start reading.'}
        </div>
      </div>
    );
  }

  const ch = chapterNumber(item.id);
  const latest = version?.latest !== false;
  const gated = run.status === 'gated' && run.gate?.itemId === item.id;
  const frontierItem = `chapter:${run.frontier}`;

  const trail = (
    <VersionTrail
      versions={item.versions}
      selectedId={version?.id ?? null}
      note={item.ready ? groupLabel : ch !== null ? `chapter ${ch} of ${run.total}` : 'not generated'}
      onSelect={onSelectVersion}
    />
  );

  // ── not written / not generated ────────────────────────────────────────
  if (!item.ready) {
    const skill = item.producedBy?.skill;
    const pipeline = item.producedBy?.pipeline;
    return (
      <div className={styles.read}>
        {trail}
        {ch !== null ? (
          <>
            <Head eyebrow={`Chapter ${ch}`} title={item.title} />
            <div className={styles.empty}>
              <div className={styles.pip}>
                {run.status === 'gated' ? `blocked by the gate at chapter ${run.frontier}` : 'queued'}
              </div>
              <h2>Not written yet</h2>
              <p>
                {run.status === 'gated'
                  ? `Generation stopped at the chapter ${run.frontier} gate. Clear that gate and the pipeline writes through to here.`
                  : 'The pipeline works forward one chapter at a time; this one is still queued.'}
              </p>
              {run.frontier > 0 && (
                <div className={styles.acts}>
                  <button className={`${btn.btn} ${btn.primary}`} onClick={() => onSelectItem(frontierItem)}>
                    Go to chapter {run.frontier}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {item.kind === 'cover' && <CoverArtboard title={bookTitle} author={authorName} caption="no cover yet" />}
            <div className={styles.empty}>
              <div className={styles.pip}>{skill ? `skill · ${skill}` : 'not generated'}</div>
              <h2>{item.title} not written yet</h2>
              <p>
                {skill
                  ? <>Run the <b>{skill}</b> skill to draft it. The result lands in this pane as normal text — fully editable here, saved straight back to its file.</>
                  : <>Nothing has written this yet. Once something does, it lands in this pane as normal text — fully editable here.</>}
              </p>
              {skill && (
                <>
                  <div className={styles.acts}>
                    <button className={`${btn.btn} ${btn.primary}`} disabled>Run {skill}</button>
                    {pipeline && <button className={btn.btn} disabled>Run {pipeline} — all {groupLabel.toLowerCase()}</button>}
                  </div>
                  <div className={styles.src}>
                    start {pipeline ? `the ${pipeline} pipeline` : 'it'} from the Board — this view reads and edits
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── written ────────────────────────────────────────────────────────────
  const eyebrow = ch !== null
    ? `Chapter ${ch}${item.words != null ? ` · ${item.words.toLocaleString()} words` : ''}`
    : groupLabel;
  const flags = item.flags ?? [];
  const latestVersionId = item.versions.find((v) => v.latest)?.id;

  return (
    <div className={styles.read}>
      {trail}
      <Head eyebrow={eyebrow} title={item.title} />

      {!latest && (
        <div className={styles.banner}>
          <span><b>{version?.label}</b>{version?.step ? ` · step ${version.step}` : ''} — an earlier version, read-only.</span>
          {latestVersionId && (
            <button className={styles.go} onClick={() => onSelectVersion(latestVersionId)}>Jump to latest</button>
          )}
        </div>
      )}

      {latest && gated && run.gate && (
        <GatePanel gate={run.gate} projectId={run.projectId} onResolved={onGateResolved} />
      )}

      {latest && !gated && flags.length > 0 && (
        <div className={styles.flagstrip}>
          <h3>Flagged on read</h3>
          <ul>{flags.map((f, i) => <li key={`${f.label}-${i}`}>{f.label}</li>)}</ul>
        </div>
      )}

      {item.kind === 'cover' && <CoverArtboard title={bookTitle} author={authorName} caption="cover brief" />}

      {loading ? (
        <div className={styles.note}>Loading…</div>
      ) : error ? (
        <div className={styles.note}><b className={styles.bad}>Couldn't load this one</b> — {error}</div>
      ) : !body.trim() ? (
        <div className={styles.note}>
          <b>Nothing in the file.</b> The step exists but its file is empty or missing — re-run the step that writes it.
        </div>
      ) : (
        <div className={`${styles.inner} ${styles.tight}`}>
          <div
            className={item.kind === 'prose' ? styles.prose : styles.docbody}
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(item.kind === 'prose' ? withoutLeadingHeading(body) : body),
            }}
          />
        </div>
      )}
    </div>
  );
}
