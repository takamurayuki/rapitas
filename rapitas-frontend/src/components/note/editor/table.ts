/**
 * Build a 3-column, 2-row table wrapped in a DocumentFragment.
 * A trailing empty paragraph is appended so the cursor can escape the table.
 */
export function createTableNode(): DocumentFragment {
  const frag = document.createDocumentFragment();

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['見出し1', '見出し2', '見出し3'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let r = 0; r < 2; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < 3; c++) {
      const td = document.createElement('td');
      td.appendChild(document.createElement('br'));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  frag.appendChild(table);

  // Empty paragraph after table so cursor can escape
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  frag.appendChild(p);

  return frag;
}
