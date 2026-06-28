// Pure file-tree model for the Files explorer. No network/@bookclaw/shared
// imports here so the tree logic is unit-testable under node:test.

export interface TreeNode {
  name: string;
  path: string;                 // book-root path (book) or filename (documents)
  source: 'book' | 'documents';
  kind: 'dir' | 'file';
  bytes?: number;
  children?: TreeNode[];        // dirs only
}

/** Build a sorted tree from the flat runner-files list + the workspace documents list. */
export function buildTree(
  files: { path: string; bytes?: number }[],
  documents: { filename: string; size?: number }[],
): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirByPath = new Map<string, TreeNode>();

  const ensureDir = (segs: string[], source: 'book' | 'documents'): TreeNode => {
    let parentChildren = roots;
    let acc = '';
    let node: TreeNode | undefined;
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      node = dirByPath.get(acc);
      if (!node) {
        node = { name: seg, path: acc, source, kind: 'dir', children: [] };
        dirByPath.set(acc, node);
        parentChildren.push(node);
      }
      parentChildren = node.children!;
    }
    return node!;
  };

  // Documents synthetic root (workspace uploads — flat list of files).
  const docsRoot: TreeNode = { name: 'Documents', path: 'Documents', source: 'documents', kind: 'dir', children: [] };
  dirByPath.set('Documents', docsRoot);
  roots.push(docsRoot);
  for (const d of documents) {
    docsRoot.children!.push({ name: d.filename, path: d.filename, source: 'documents', kind: 'file', bytes: d.size });
  }

  // Book files (data/… and templates/…), folded into nested dirs.
  for (const f of files) {
    const segs = f.path.split('/');
    const fileName = segs.pop()!;
    const parent = segs.length ? ensureDir(segs, 'book') : null;
    const fileNode: TreeNode = { name: fileName, path: f.path, source: 'book', kind: 'file', bytes: f.bytes };
    (parent ? parent.children! : roots).push(fileNode);
  }

  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  // Keep the Documents root pinned at the top, book roots (data/, templates/) after.
  const di = roots.findIndex((n) => n.source === 'documents' && n.name === 'Documents');
  if (di > 0) roots.unshift(roots.splice(di, 1)[0]);
  return roots;
}

const TEXT_RE = /\.(md|markdown|txt|text|log|csv|json)$/i;
export const isTextName = (name: string): boolean => TEXT_RE.test(name);
