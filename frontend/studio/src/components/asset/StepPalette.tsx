// Drag source for the visual pipeline builder: step presets, the skills
// library, and structural group blocks. Cards drag into the flow (ids from
// paletteId) or click to append at the end.
import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { STEP_PRESETS, paletteId, type PaletteItem } from '../../lib/stepPresets.js';
import styles from '../../routes/AssetStudio.module.css';

function Card({ item, label, hint, onAppend }: {
  item: PaletteItem; label: string; hint?: string; onAppend: (item: PaletteItem) => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: paletteId(item) });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={styles.palcard}
      onClick={() => onAppend(item)}
      title="Drag into the pipeline, or click to add at the end"
    >
      <span className={styles.grip}>⠿</span>
      <span>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export function StepPalette({ skills, onAppend }: {
  skills: string[];
  onAppend: (item: PaletteItem) => void;
}) {
  const [q, setQ] = useState('');
  const shown = skills.filter((s) => s.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className={styles.palette}>
      <div className={styles.palsec}>Blocks</div>
      <Card item={{ type: 'block', kind: 'parallel' }} label="Run in parallel" onAppend={onAppend} />
      <Card item={{ type: 'block', kind: 'expand' }} label="Repeat per chapter" onAppend={onAppend} />
      <div className={styles.palsec}>Step presets</div>
      {STEP_PRESETS.map((p) => (
        <Card key={p.key} item={{ type: 'preset', key: p.key }} label={p.label} hint={p.taskType} onAppend={onAppend} />
      ))}
      <div className={styles.palsec}>Skills</div>
      <input className={styles.palfilter} placeholder="filter skills…" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.map((s) => (
        <Card key={s} item={{ type: 'skill', name: s }} label={s} onAppend={onAppend} />
      ))}
      {shown.length === 0 && (
        <div style={{ color: 'var(--faint)', fontSize: 12 }}>
          {skills.length === 0 ? 'No skills available.' : 'No skills match.'}
        </div>
      )}
    </div>
  );
}
