import type { ReactNode } from "react";

const TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlightJson(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of json.matchAll(TOKEN)) {
    if (match.index > last) nodes.push(json.slice(last, match.index));
    const [whole, string, colon, bool, nil, number] = match;
    const key = `${match.index}`;
    if (string !== undefined && colon !== undefined) {
      nodes.push(
        <span key={key} className="j-key">
          {string}
        </span>,
        colon,
      );
    } else if (string !== undefined) {
      nodes.push(
        <span key={key} className="j-str">
          {string}
        </span>,
      );
    } else if (bool !== undefined) {
      nodes.push(
        <span key={key} className="j-bool">
          {bool}
        </span>,
      );
    } else if (nil !== undefined) {
      nodes.push(
        <span key={key} className="j-null">
          {nil}
        </span>,
      );
    } else if (number !== undefined) {
      nodes.push(
        <span key={key} className="j-num">
          {number}
        </span>,
      );
    } else {
      nodes.push(whole);
    }
    last = match.index + whole.length;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return nodes;
}
