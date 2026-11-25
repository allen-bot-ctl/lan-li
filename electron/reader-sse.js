'use strict';

// Chat Completions sends UTF-8 SSE; one event may span TCP chunks and data lines.
async function* sse(body) {
  if (!body?.[Symbol.asyncIterator]) throw new Error('missing stream');
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let line = '', data = [], size = 0, swallowLf = false;
  function feed(ch) {
    if (swallowLf) { swallowLf = false; if (ch === '\n') return; }
    if (ch !== '\r' && ch !== '\n') {
      if (line.length >= 2_000_000) throw new Error('stream line oversized');
      line += ch;
      return;
    }
    swallowLf = ch === '\r';
    if (!line) {
      if (!data.length) return;
      const event = data.join('\n'); data = []; size = 0;
      return event;
    }
    if (line === 'data' || line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /,'');
      size += value.length + 1;
      if (size > 2_000_000) throw new Error('stream event oversized');
      data.push(value);
    }
    line = '';
  }
  for await (const chunk of body) {
    for (const ch of decoder.decode(chunk,{stream:true})) {
      const frame = feed(ch);
      if (frame !== undefined) yield frame;
    }
  }
  for (const ch of decoder.decode()) {
    const frame = feed(ch);
    if (frame !== undefined) yield frame;
  }
}

module.exports = {sse};
