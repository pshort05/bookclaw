import { useMemo } from 'react';
import styles from '../../routes/NewBook.module.css';

export interface StructureOpt { id: string; name: string; oneLiner?: string }
export interface FormOpt { id: string; label: string; description?: string; minWords: number; maxWords: number | null; typicalChapterRange: [number, number] }

export interface FormatValue {
  structure: string;          // structure id or 'custom' or '' (none)
  customStructureText: string; // beat lines when structure === 'custom'
  form: string;               // form id or '' (none)
  chapterCount: number;
  wordsPerChapter: number;
}

export const EMPTY_FORMAT: FormatValue = { structure: '', customStructureText: '', form: '', chapterCount: 0, wordsPerChapter: 0 };

/** Parse "Beat Name : 0-25 : description" lines into a custom StoryStructure. */
export function parseCustomStructure(text: string): { id: 'custom'; name: string; oneLiner: string; recommendedFor: string[]; worksLessWellFor: string[]; why: string; beats: Array<{ name: string; expectedPct: number; pctRange: [number, number]; description: string; keywords: string[]; mustHave: boolean }> } {
  const beats = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, range, description] = line.split(':').map((s) => s.trim());
    let lo = 0, hi = 100;
    const m = (range ?? '').match(/(\d+)\s*-\s*(\d+)/);
    if (m) { lo = Number(m[1]); hi = Number(m[2]); }
    return { name: name || 'Beat', expectedPct: Math.round((lo + hi) / 2), pctRange: [lo, hi] as [number, number], description: description || '', keywords: [], mustHave: true };
  });
  return { id: 'custom', name: 'Custom', oneLiner: '', recommendedFor: [], worksLessWellFor: [], why: '', beats };
}

/** Whether chapterCount × wordsPerChapter fits the chosen form's band. Mirrors validateFormFit. */
export function formatFit(value: FormatValue, forms: FormOpt[]): { active: boolean; total: number; ok: boolean; message?: string } {
  const active = !!(value.structure || value.form || value.chapterCount || value.wordsPerChapter);
  const total = Math.max(0, Math.floor(value.chapterCount)) * Math.max(0, Math.floor(value.wordsPerChapter));
  if (!active) return { active: false, total: 0, ok: true };
  if (!value.structure) return { active, total, ok: false, message: 'Pick a structure.' };
  if (!value.form) return { active, total, ok: false, message: 'Pick a form/length.' };
  if (value.chapterCount < 1 || value.wordsPerChapter < 1) return { active, total, ok: false, message: 'Set chapter count and words per chapter.' };
  const form = forms.find((f) => f.id === value.form);
  if (!form) return { active, total, ok: false, message: 'Unknown form.' };
  if (total < form.minWords) return { active, total, ok: false, message: `${form.label} is at least ${form.minWords.toLocaleString()} words; ${total.toLocaleString()} is too short.` };
  if (form.maxWords !== null && total > form.maxWords) return { active, total, ok: false, message: `${form.label} is at most ${form.maxWords.toLocaleString()} words; ${total.toLocaleString()} exceeds the band.` };
  return { active, total, ok: true };
}

export function FormatPicker({ structures, forms, value, onChange }: {
  structures: StructureOpt[];
  forms: FormOpt[];
  value: FormatValue;
  onChange: (v: FormatValue) => void;
}) {
  const fit = useMemo(() => formatFit(value, forms), [value, forms]);
  const set = (patch: Partial<FormatValue>) => onChange({ ...value, ...patch });

  return (
    <section className={styles.pick}>
      <div className={styles.ph}>
        <h3>Format &amp; Structure<span className={styles.pickone}> · optional — declares the shape, length &amp; pacing</span></h3>
      </div>
      <div className={styles.def}>Pick a narrative structure and a form. Chapter count × words-per-chapter is the pacing dial; the total must fit the form's word band.</div>

      <div className={styles.idblock} style={{ marginTop: 0 }}>
        <div className={styles.fl}>Structure</div>
        <select className={styles.tin} value={value.structure} onChange={(e) => set({ structure: e.target.value })}>
          <option value="">— none —</option>
          {structures.filter((s) => s.id !== 'none').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="custom">Other / Custom…</option>
        </select>
      </div>
      {value.structure === 'custom' && (
        <div className={styles.idblock}>
          <div className={styles.fl}>Custom beats <span className={styles.pickone}>· one per line — "Name : 0-25 : description"</span></div>
          <textarea className={styles.tin} rows={5} value={value.customStructureText}
            onChange={(e) => set({ customStructureText: e.target.value })}
            placeholder={'Summer One : 0-22 : the first summer\nWinter Interlude : 22-28 : the gap between'} />
        </div>
      )}

      <div className={styles.idblock}>
        <div className={styles.fl}>Form / Length</div>
        <select className={styles.tin} value={value.form} onChange={(e) => set({ form: e.target.value })}>
          <option value="">— none —</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.minWords.toLocaleString()}{f.maxWords ? `–${f.maxWords.toLocaleString()}` : '+'} words)</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div className={styles.idblock} style={{ flex: 1 }}>
          <div className={styles.fl}>Chapters</div>
          <input className={styles.tin} type="number" min={1} value={value.chapterCount || ''} onChange={(e) => set({ chapterCount: Number(e.target.value) })} />
        </div>
        <div className={styles.idblock} style={{ flex: 1 }}>
          <div className={styles.fl}>Words / chapter</div>
          <input className={styles.tin} type="number" min={1} value={value.wordsPerChapter || ''} onChange={(e) => set({ wordsPerChapter: Number(e.target.value) })} />
        </div>
      </div>

      {fit.active && (
        <div className={styles.def} style={{ color: fit.ok ? 'var(--ok, inherit)' : 'var(--alert)' }}>
          Total: {fit.total.toLocaleString()} words — {fit.ok ? 'within band ✓' : fit.message}
        </div>
      )}
    </section>
  );
}
