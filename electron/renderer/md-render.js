'use strict';
// 0.1.62：把 markdown-it 的 token 流转成 DOM（createElement + textContent）。
// 模型输出绝不当 HTML 插入；markdown-it 以 html:false 创建，原始 HTML 只会当文字显示。
(function (root) {
  function createMd(MarkdownIt) {
    return new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
  }

  function isHttp(u) {
    try { const p = new URL(String(u)); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
  }

  // md：createMd 的结果；doc：document；onLink(href)：点击 http/https 链接时回调
  function renderInto(container, md, text, doc, onLink) {
    const tokens = md.parse(String(text == null ? '' : text), {});
    const stack = [container];
    const top = () => stack[stack.length - 1];
    const push = (el) => { top().appendChild(el); stack.push(el); return el; };

    function inline(children, into) {
      const marks = [into];
      const cur = () => marks[marks.length - 1];
      for (const t of children || []) {
        switch (t.type) {
          case 'text': cur().appendChild(doc.createTextNode(t.content)); break;
          case 'softbreak': cur().appendChild(doc.createTextNode('\n')); break;
          case 'hardbreak': cur().appendChild(doc.createElement('br')); break;
          case 'code_inline': { const c = doc.createElement('code'); c.textContent = t.content; cur().appendChild(c); break; }
          case 'strong_open': case 'em_open': case 's_open': {
            const e = doc.createElement(t.type === 'strong_open' ? 'strong' : (t.type === 'em_open' ? 'em' : 's'));
            cur().appendChild(e); marks.push(e); break;
          }
          case 'strong_close': case 'em_close': case 's_close': if (marks.length > 1) marks.pop(); break;
          case 'link_open': {
            const href = (t.attrs || []).find((a) => a[0] === 'href');
            const e = doc.createElement('span');
            e.className = 'md-link';
            if (href && isHttp(href[1])) {
              e.dataset.href = href[1];
              e.setAttribute('role', 'link');
              e.tabIndex = 0;
              e.addEventListener('click', () => { if (onLink) onLink(href[1]); });
            }
            cur().appendChild(e); marks.push(e); break;
          }
          case 'link_close': if (marks.length > 1) marks.pop(); break;
          case 'image': cur().appendChild(doc.createTextNode(t.content || '')); break;
          default:
            if (t.content) cur().appendChild(doc.createTextNode(t.content));
        }
      }
    }

    for (const t of tokens) {
      switch (t.type) {
        case 'heading_open': { const lvl = Math.min(3, Number(t.tag.slice(1)) || 3); push(doc.createElement('div')).className = 'md-h md-h' + lvl; break; }
        case 'heading_close': stack.pop(); break;
        case 'paragraph_open': if (!t.hidden) push(doc.createElement('p')); else stack.push(top()); break;
        case 'paragraph_close': stack.pop(); break;
        case 'bullet_list_open': push(doc.createElement('ul')); break;
        case 'ordered_list_open': { const ol = push(doc.createElement('ol')); const st = (t.attrs || []).find((a) => a[0] === 'start'); if (st) ol.start = Number(st[1]) || 1; break; }
        case 'bullet_list_close': case 'ordered_list_close': stack.pop(); break;
        case 'list_item_open': push(doc.createElement('li')); break;
        case 'list_item_close': stack.pop(); break;
        case 'table_open': case 'thead_open': case 'tbody_open': case 'tr_open': case 'th_open': case 'td_open': push(doc.createElement(t.tag)); break;
        case 'table_close': case 'thead_close': case 'tbody_close': case 'tr_close': case 'th_close': case 'td_close': stack.pop(); break;
        case 'blockquote_open': push(doc.createElement('blockquote')); break;
        case 'blockquote_close': stack.pop(); break;
        case 'hr': top().appendChild(doc.createElement('hr')); break;
        case 'fence': case 'code_block': {
          const pre = doc.createElement('pre'); const c = doc.createElement('code');
          c.textContent = t.content.replace(/\n$/, ''); pre.appendChild(c); top().appendChild(pre); break;
        }
        case 'inline': inline(t.children, top()); break;
        case 'html_block': { const p = doc.createElement('p'); p.textContent = t.content.replace(/\n$/, ''); top().appendChild(p); break; }
        default: break;
      }
    }
    return container;
  }

  const api = { createMd, renderInto, isHttp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MdRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
