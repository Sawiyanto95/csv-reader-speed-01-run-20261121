// Fast drop-in for csv-reader 1.0.0: the same answers, faster.
//
// Semantics follow the reference exactly (competition rules):
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF, and a line left with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (stray_cr);
// - a field that opens with a quote runs to the next quote that is not doubled,
//   "" inside it is one quote, each CRLF or lone CR inside it reads as LF;
//   what follows its closing quote, up to the next comma or line break, is
//   appended as it stands (quote_junk, when the field ends); a quote that
//   never closes is a literal character, and the text after it is read again
//   as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character;
// - fields stay strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds the
//   records after it, each padded with "" (short_row) or cut (long_row) to the
//   first record's width;
// - each error is {code, line, row}, in the order met; line is the 1-based line
//   its record starts on, row its record's index in rows (null for the header).
//
// Speed comes from scanning with native primitives instead of one character at
// a time: an unquoted field ends at the next comma or line break, found with
// indexOf, and a quoted field with indexOf for its closing quote; field values
// are slices of the input, never built a character at a time. Nothing is kept
// from one call to the next: no clock, no randomness, no locale, no cache.

/** How a field ended. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // the next character to read
  let line = 1; // the line that character is on

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // What the last field read was: its value, how it ended, and how many characters the unquoted read kept.
  // Shared out-variables, so reading a field allocates nothing of its own.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Appends `seg` (a slice of the text) onto `value`, dropping lone CRs (each a stray_cr). When `crlf` is
  // true the character after the slice is a LF, so a CR at the very end of the slice is the CR of a
  // CRLF, not a stray one. Returns the value; the fast path, no CR in the slice, is one concatenation.
  function appendClean(value, seg, crlf) {
    let cr = seg.indexOf('\r');
    if (cr === -1) return value + seg;
    let out = value;
    let s = 0;
    for (;;) {
      if (cr === seg.length - 1 && crlf) {
        // The CR of a CRLF: dropped, and the slice ends here.
        return out + seg.slice(s, cr);
      }
      error('stray_cr');
      out += seg.slice(s, cr);
      s = cr + 1;
      cr = seg.indexOf('\r', s);
      if (cr === -1) return out + seg.slice(s);
    }
  }

  // Reads unquoted characters onto `value` up to the next comma or line break. Sets fValue, fEnded, fAdded.
  function readUnquoted(value) {
    const cIdx = text.indexOf(',', pos);
    if (cIdx === -1) {
      const nIdx = text.indexOf('\n', pos);
      if (nIdx === -1) {
        const before = value.length;
        fValue = appendClean(value, text.slice(pos, n), false);
        fAdded = fValue.length - before;
        pos = n;
        fEnded = END;
        return;
      }
      const before = value.length;
      fValue = appendClean(value, text.slice(pos, nIdx), true);
      fAdded = fValue.length - before;
      pos = nIdx + 1;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    const seg = text.slice(pos, cIdx);
    const nl = seg.indexOf('\n');
    if (nl === -1) {
      const before = value.length;
      fValue = appendClean(value, seg, false);
      fAdded = fValue.length - before;
      pos = cIdx + 1;
      fEnded = COMMA;
      return;
    }
    const before = value.length;
    fValue = appendClean(value, seg.slice(0, nl), true);
    fAdded = fValue.length - before;
    pos = pos + nl + 1;
    line += 1;
    fEnded = LINE_BREAK;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded, fAdded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let chunkStart = pos + 1;
    for (;;) {
      const q = text.indexOf('"', chunkStart);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one quote in the value, keep looking.
        value += text.slice(chunkStart, q) + '"';
        chunkStart = q + 2;
        continue;
      }
      value += text.slice(chunkStart, q);
      // Each CRLF or lone CR inside the quotes reads as LF, and each LF, CRLF or lone CR inside them is a line.
      if (value.indexOf('\r') !== -1) {
        const breaks = value.match(/\r\n|\r|\n/g);
        if (breaks !== null) line += breaks.length;
        value = value.replace(/\r\n?/g, '\n');
      } else if (value.indexOf('\n') !== -1) {
        const breaks = value.match(/\n/g);
        if (breaks !== null) line += breaks.length;
      }
      pos = q + 1;
      if (pos >= n) {
        fValue = value;
        fEnded = END;
        fAdded = 0;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = 0;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      readUnquoted(value);
      if (fAdded > 0) error('quote_junk');
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
