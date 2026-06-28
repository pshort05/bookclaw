import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../../lib/filesExplorerApi.js';

interface Props {
  nodes: TreeNode[];
  selectedPath?: string;
  currentDir?: string;
  onSelectFile: (n: TreeNode) => void;
  onSelectDir: (n: TreeNode) => void;
}

const FolderIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', opacity: 0.8 }}>
    {open ? <path d="M3 7l2-2h5l2 2h7v3H3z M3 10l1.5 8h15L21 10" /> : <path d="M3 7a1 1 0 011-1h5l2 2h8a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z" />}
  </svg>
);
const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', opacity: 0.6 }}>
    <path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" />
  </svg>
);

function Row({ node, depth, selectedPath, currentDir, open, onToggle, onSelectFile, onSelectDir }: {
  node: TreeNode; depth: number; selectedPath?: string; currentDir?: string; open: Set<string>;
  onToggle: (p: string) => void; onSelectFile: (n: TreeNode) => void; onSelectDir: (n: TreeNode) => void;
}) {
  const isOpen = open.has(node.path);
  const isFile = node.kind === 'file';
  const active = isFile ? node.path === selectedPath : node.path === currentDir;
  return (
    <>
      <div
        onClick={() => { if (isFile) onSelectFile(node); else { onToggle(node.path); onSelectDir(node); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer',
          padding: '4px 8px', paddingLeft: 8 + depth * 14, borderRadius: 6, fontSize: 13,
          color: active ? 'var(--text)' : 'var(--dim)',
          background: active ? 'rgba(240,145,58,.12)' : undefined,
        }}
        title={node.path}
      >
        {!isFile && (
          <span style={{ width: 10, flex: 'none', fontSize: 9, opacity: 0.7 }}>{isOpen ? '▾' : '▸'}</span>
        )}
        {isFile ? <FileIcon /> : <FolderIcon open={isOpen} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </div>
      {!isFile && isOpen && node.children?.map((c) => (
        <Row key={c.path} node={c} depth={depth + 1} selectedPath={selectedPath} currentDir={currentDir}
          open={open} onToggle={onToggle} onSelectFile={onSelectFile} onSelectDir={onSelectDir} />
      ))}
    </>
  );
}

export function FileTree({ nodes, selectedPath, currentDir, onSelectFile, onSelectDir }: Props) {
  // Top-level roots (Documents, data, templates) open by default. The tree data
  // arrives after mount, so open each root the first time it appears (tracked in
  // `seeded` so a later refresh doesn't re-open a root the user manually closed).
  const [open, setOpen] = useState<Set<string>>(new Set());
  const seeded = useRef<Set<string>>(new Set());
  useEffect(() => {
    setOpen((s) => {
      const n = new Set(s);
      for (const r of nodes) if (!seeded.current.has(r.path)) { n.add(r.path); seeded.current.add(r.path); }
      return n;
    });
  }, [nodes]);
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  return (
    <div>
      {nodes.map((n) => (
        <Row key={n.path} node={n} depth={0} selectedPath={selectedPath} currentDir={currentDir}
          open={open} onToggle={toggle} onSelectFile={onSelectFile} onSelectDir={onSelectDir} />
      ))}
    </div>
  );
}
