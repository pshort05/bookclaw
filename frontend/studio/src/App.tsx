import { Outlet } from 'react-router-dom';
import { Rail } from './Rail.js';
import styles from './App.module.css';
export function App() {
  return <div className={styles.app}><Rail /><main className={styles.main}><Outlet /></main></div>;
}
