/**
 * BookClaw Configuration Service
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

export class ConfigService {
  private configDir: string;
  // Where runtime overrides are read from and written to. Defaults to the baked
  // config/user.json (back-compat), but production points this at a file on the
  // persistent workspace bind-mount so setAndPersist survives image rebuilds — the
  // baked config/user.json is reset on every recreate (was reverting settings).
  private overridesPath: string;
  private config: Record<string, any> = {};
  private userOverrides: Record<string, any> = {};

  constructor(configDir: string, overridesPath?: string) {
    this.configDir = configDir;
    this.overridesPath = overridesPath ?? join(configDir, 'user.json');
  }

  async load(): Promise<void> {
    const defaultPath = join(this.configDir, 'default.json');
    if (existsSync(defaultPath)) {
      const raw = await readFile(defaultPath, 'utf-8');
      this.config = JSON.parse(raw);
    }

    // Baked user.json is a read-only seed layer (image-baked defaults). Merge it,
    // but it is never written back to — runtime writes go to overridesPath.
    const bakedPath = join(this.configDir, 'user.json');
    let baked: Record<string, any> = {};
    if (existsSync(bakedPath)) {
      baked = JSON.parse(await readFile(bakedPath, 'utf-8'));
      this.config = this.deepMerge(this.config, baked);
    }

    // Persistent runtime overrides win over the baked seed. If the overrides file
    // doesn't exist yet, seed the in-memory set from the baked layer so the first
    // setAndPersist writes a superset (no baked settings are lost on migration).
    if (existsSync(this.overridesPath) && this.overridesPath !== bakedPath) {
      this.userOverrides = JSON.parse(await readFile(this.overridesPath, 'utf-8'));
      this.config = this.deepMerge(this.config, this.userOverrides);
    } else {
      this.userOverrides = structuredClone(baked);
    }

    // Environment variable overrides
    if (process.env.BOOKCLAW_PORT) {
      const port = parseInt(process.env.BOOKCLAW_PORT, 10);
      if (Number.isInteger(port) && port > 0) this.set('server.port', port);
    }
    if (process.env.BOOKCLAW_PRESET) this.set('security.permissionPreset', process.env.BOOKCLAW_PRESET);
  }

  get(path: string, defaultValue?: any): any {
    const parts = path.split('.');
    let current = this.config;
    for (const part of parts) {
      if (current?.[part] === undefined) return defaultValue;
      current = current[part];
    }
    return current ?? defaultValue;
  }

  set(path: string, value: any): void {
    const parts = path.split('.');
    let current = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      const existing = current[parts[i]];
      if (existing === undefined || existing === null) {
        current[parts[i]] = {};
      } else if (typeof existing !== 'object' || Array.isArray(existing)) {
        // Refuse to drill into a primitive / array — prevents silent data loss
        // when someone calls set('server.port', 3000) but server is a string.
        throw new Error(
          `Cannot set '${path}': '${parts.slice(0, i + 1).join('.')}' is a ${typeof existing}, not an object.`
        );
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  /** Set a value and persist it to config/user.json so it survives restarts. */
  async setAndPersist(path: string, value: any): Promise<void> {
    this.set(path, value);

    // Also update userOverrides
    const parts = path.split('.');
    let current = this.userOverrides;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    // Write to the persistent overrides path (workspace-backed in production).
    await mkdir(dirname(this.overridesPath), { recursive: true });
    await writeFile(this.overridesPath, JSON.stringify(this.userOverrides, null, 2), 'utf-8');
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }
}
