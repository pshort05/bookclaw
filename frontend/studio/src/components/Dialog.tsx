import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@bookclaw/shared';
import styles from './Dialog.module.css';

/**
 * In-app replacement for the browser's native window.confirm/prompt/alert.
 *
 * Mount <DialogProvider> once at the app root; call sites use the useDialog()
 * hook and `await` the imperative methods, mirroring the native API so the
 * migration is a near drop-in:
 *
 *   const { confirm } = useDialog();
 *   if (!(await confirm('Delete this?'))) return;
 *
 * Each method accepts a message string or an options object. confirm resolves to
 * a boolean, prompt to the entered string (or null if cancelled), alert to void.
 */
type ConfirmOpts = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = { title?: string; message: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string };
type AlertOpts = { title?: string; message: string; okLabel?: string };

interface DialogApi {
  confirm(opts: ConfirmOpts | string): Promise<boolean>;
  prompt(opts: PromptOpts | string): Promise<string | null>;
  alert(opts: AlertOpts | string): Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

type Active =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'alert'; opts: AlertOpts; resolve: () => void };

const toMessageOpts = <T extends { message: string }>(o: T | string): T =>
  (typeof o === 'string' ? ({ message: o } as T) : o);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const [value, setValue] = useState('');

  const api: DialogApi = {
    confirm: (o) => new Promise<boolean>((resolve) => setActive({ kind: 'confirm', opts: toMessageOpts(o), resolve })),
    prompt: (o) => new Promise<string | null>((resolve) => {
      const opts = toMessageOpts(o) as PromptOpts;
      setValue(opts.defaultValue ?? '');
      setActive({ kind: 'prompt', opts, resolve });
    }),
    alert: (o) => new Promise<void>((resolve) => setActive({ kind: 'alert', opts: toMessageOpts(o), resolve })),
  };

  // accept = the affirmative outcome; cancel = the negative (Esc / scrim / Cancel).
  const accept = () => {
    if (!active) return;
    if (active.kind === 'confirm') active.resolve(true);
    else if (active.kind === 'prompt') active.resolve(value);
    else active.resolve();
    setActive(null);
  };
  const cancel = () => {
    if (!active) return;
    if (active.kind === 'confirm') active.resolve(false);
    else if (active.kind === 'prompt') active.resolve(null);
    else active.resolve(); // alert has no negative outcome
    setActive(null);
  };

  // Esc cancels; Enter accepts. (Bound while a dialog is open.)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && active.kind !== 'prompt') { e.preventDefault(); accept(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps -- accept/cancel are re-derived per render and only read here

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active && (
        <>
          <div className={`${styles.scrim}`} onClick={cancel} />
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label={active.opts.title ?? active.kind}>
            {active.opts.title && <h2 className={styles.h2}>{active.opts.title}</h2>}
            <p className={styles.msg}>{active.opts.message}</p>

            {active.kind === 'prompt' && (
              <input
                className={styles.input}
                value={value}
                placeholder={active.opts.placeholder}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); accept(); }
                }}
                aria-label={active.opts.title ?? 'Input'}
              />
            )}

            <div className={styles.foot}>
              {active.kind !== 'alert' && (
                <Button variant="secondary" onClick={cancel}>
                  {(active.kind === 'confirm' && active.opts.cancelLabel) ||
                    (active.kind === 'prompt' && active.opts.cancelLabel) ||
                    'Cancel'}
                </Button>
              )}
              <Button variant="primary" onClick={accept}>
                {active.kind === 'confirm' ? (active.opts.confirmLabel ?? 'OK')
                  : active.kind === 'prompt' ? (active.opts.confirmLabel ?? 'OK')
                  : (active.opts.okLabel ?? 'OK')}
              </Button>
            </div>
          </div>
        </>
      )}
    </DialogContext.Provider>
  );
}

/**
 * Access the dialog API. Throws if used outside <DialogProvider> so a missing
 * provider fails loudly at the call site rather than silently no-op'ing.
 */
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within a <DialogProvider>');
  return ctx;
}
