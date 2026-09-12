import styles from './RawPane.module.css';
import btn from './buttons.module.css';

/**
 * The raw markdown editor (design §5). Whether the text can be edited is the
 * server's call — `editable` comes back with the item and this pane only
 * reflects it: dimmed editor, gold lock bar, Save/Revert disabled.
 */
export function RawPane({
  file, value, dirty, editable, lockReason, saveLabel, delta, saving, error,
  onChange, onSave, onRevert,
}: {
  file: string | null;
  value: string;
  dirty: boolean;
  editable: boolean;
  lockReason: string;
  saveLabel: string;
  delta: string;
  saving: boolean;
  error: string | null;
  onChange: (next: string) => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  const lineCount = value.split('\n').length;

  return (
    <div className={`${styles.raw} ${editable ? '' : styles.locked}`} aria-label="Raw markdown">
      <div className={styles.rawhead}>
        {dirty && editable && <div className={styles.dot} />}
        <div className={styles.f}>{file ?? '—'}</div>
        <div className={`${styles.state} ${dirty && editable ? styles.dirty : ''}`}>
          {!editable ? 'read-only' : saving ? 'saving…' : dirty ? 'unsaved changes' : 'saved'}
        </div>
      </div>

      {!editable && <div className={styles.lockbar}>🔒&nbsp; {lockReason}</div>}

      <div className={styles.editor}>
        <div className={styles.gutter}>
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          className={styles.src}
          spellCheck={false}
          aria-label="Raw markdown source"
          readOnly={!editable}
          rows={lineCount + 2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>

      {error && <div className={styles.err}>{error}</div>}

      <div className={styles.rawfoot}>
        <button
          className={`${btn.btn} ${btn.primary}`}
          disabled={!editable || !dirty || saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
        <button className={btn.btn} disabled={!editable || !dirty || saving} onClick={onRevert}>Revert</button>
        <div className={styles.delta}>{delta}</div>
      </div>
    </div>
  );
}
