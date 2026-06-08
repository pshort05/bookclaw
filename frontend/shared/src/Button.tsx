import React from 'react';
import styles from './Button.module.css';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'; shortcut?: string;
};

export function Button({ variant = 'primary', shortcut, className, children, ...rest }: Props) {
  const cls = [variant === 'secondary' ? styles.key : styles.btn, className].filter(Boolean).join(' ');
  return <button className={cls} {...rest}>{children}{shortcut && <span className={styles.kk}>{shortcut}</span>}</button>;
}
