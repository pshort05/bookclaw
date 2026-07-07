// Generic dnd-kit wrappers for the Asset Studio. Nothing pipeline-specific:
// SequenceEditor uses DndList (flat list, own DndContext); PipelineEditor
// builds its own DndContext (palette + nested group containers) out of
// useDndSensors + SortableRow + DragHandle.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent, type DraggableAttributes, type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface HandleBindings { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners }
const HandleCtx = createContext<HandleBindings | null>(null);

export function useDndSensors() {
  return useSensors(
    // 6px activation distance so plain clicks (accordion toggle) never start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** One sortable row. Render a <DragHandle/> somewhere inside to grip it. */
export function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <HandleCtx.Provider value={{ attributes, listeners }}>{children}</HandleCtx.Provider>
    </div>
  );
}

export function DragHandle({ title = 'Drag to move' }: { title?: string }) {
  const ctx = useContext(HandleCtx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      {...ctx.attributes}
      {...ctx.listeners}
      title={title}
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: 'grab', background: 'transparent', border: 'none', color: 'var(--faint)', padding: '2px 6px', fontSize: 14, lineHeight: 1, touchAction: 'none', flex: 'none' }}
    >⠿</button>
  );
}

/** Flat sortable list with its own DndContext. onMove gets original-array indices. */
export function DndList({ ids, onMove, children }: {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useDndSensors();
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  );
}
