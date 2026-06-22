import type { LibraryEntry } from '@bookclaw/shared';
import { OptionCard } from './OptionCard.js';
import { GLOSSARY } from '../../lib/glossary.js';
import type { WorldListRow } from '../../lib/worldApi.js';
import styles from '../../routes/NewBook.module.css';

/** Single-select, optional World picker — mirrors the genre picker's simple variant. */
export function WorldPicker({ worlds, value, onChange, locked }: {
  worlds: WorldListRow[]; value: string; onChange: (name: string) => void; locked?: boolean;
}) {
  const g = GLOSSARY.world;
  return (
    <section className={styles.pick}>
      <div className={styles.ph}>
        <h3>{g.canon}<span className={styles.pickone}> · optional{locked ? ' — from series' : ''}</span></h3>
        <span className={styles.canon}>term · {g.canon}</span>
      </div>
      <div className={styles.def}>{g.def}</div>
      <div className={locked ? styles.locked : undefined}>
        <div className={styles.grid2}>
          {worlds.map((wld) => {
            const entry: LibraryEntry = { kind: 'world', name: wld.name, source: wld.source, description: wld.description ?? wld.label };
            return (
              <OptionCard
                key={wld.name}
                entry={entry}
                mode="single"
                selected={value === wld.name}
                onToggle={() => { if (!locked) onChange(value === wld.name ? '' : wld.name); }}
              />
            );
          })}
          {worlds.length === 0 && <p className={styles.def}>None in the library yet.</p>}
        </div>
      </div>
    </section>
  );
}
