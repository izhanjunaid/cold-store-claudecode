import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { addRowTo, canRemoveRow, removeRowAt, updateRowAt, EditableRows, type EditableRowColumn } from './editable-rows';

interface Row {
  id: string;
  qty: number;
}

describe('addRowTo', () => {
  it('appends without mutating the original array', () => {
    const rows: Row[] = [{ id: 'a', qty: 1 }];
    const next = addRowTo(rows, { id: 'b', qty: 0 });
    expect(next).toEqual([{ id: 'a', qty: 1 }, { id: 'b', qty: 0 }]);
    expect(rows).toHaveLength(1);
  });
});

describe('removeRowAt', () => {
  it('drops only the row at the given index', () => {
    const rows: Row[] = [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }, { id: 'c', qty: 3 }];
    expect(removeRowAt(rows, 1)).toEqual([{ id: 'a', qty: 1 }, { id: 'c', qty: 3 }]);
  });
});

describe('updateRowAt', () => {
  it('merges the patch into only the targeted row', () => {
    const rows: Row[] = [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }];
    expect(updateRowAt(rows, 0, { qty: 9 })).toEqual([{ id: 'a', qty: 9 }, { id: 'b', qty: 2 }]);
  });
});

describe('canRemoveRow', () => {
  it('allows removal while above the minRows floor', () => {
    expect(canRemoveRow(3, 1)).toBe(true);
  });

  it('blocks removal at or below the minRows floor', () => {
    expect(canRemoveRow(1, 1)).toBe(false);
    expect(canRemoveRow(0, 1)).toBe(false);
  });

  it('defaults to removable when minRows is 0', () => {
    expect(canRemoveRow(1, 0)).toBe(true);
  });
});

const columns: EditableRowColumn<Row>[] = [
  { key: 'qty', header: 'Qty', width: '1fr', render: (row) => <span>{row.qty}</span> },
];
const rows: Row[] = [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }];

describe('EditableRows — removable', () => {
  it('renders a remove button per row by default', () => {
    render(<EditableRows rows={rows} onChange={() => {}} columns={columns} newRow={() => ({ id: 'c', qty: 0 })} />);
    expect(screen.getAllByLabelText('Remove row')).toHaveLength(2);
  });

  it('hides the remove column entirely when removable is false — a fixed-roster editor has no delete affordance', () => {
    render(
      <EditableRows
        rows={rows}
        onChange={() => {}}
        columns={columns}
        newRow={() => rows[0]!}
        removable={false}
        maxRows={rows.length}
      />,
    );
    expect(screen.queryByLabelText('Remove row')).not.toBeInTheDocument();
  });
});
