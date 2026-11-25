'use strict';
const { Editor } = require('@tiptap/core');
const { Fragment, Slice } = require('@tiptap/pm/model');
const { Selection } = require('@tiptap/pm/state');
const { extensions } = require('../inbox-document-schema');

function createWriter(element, toolbar) {
  let assets = Object.create(null);
  function updateToolbar(editor) {
    for (const control of toolbar.querySelectorAll('[data-wys]')) {
      const [name, level] = control.dataset.wys.split(':');
      control.setAttribute('aria-pressed', String(editor.isActive(name, level ? { level: Number(level) } : undefined)));
    }
  }
  const editor = new Editor({
    element, extensions: extensions(), injectCSS: false,
    editorProps: {
      attributes: { 'aria-label': '收纳正文', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
      clipboardTextParser(text, context) {
        const schema = context.doc.type.schema;
        const blocks = text.replace(/\r\n?/g, '\n').split('\n')
          .map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
        return new Slice(Fragment.fromArray(blocks), 0, 0);
      },
      transformPastedHTML(html) {
        // The capture channel owns adding attachments; never accept an image
        // URL directly in an existing editor session.
        const doc = new DOMParser().parseFromString(html, 'text/html');
        for (const n of doc.querySelectorAll('img')) n.remove();
        return doc.body.innerHTML;
      },
    },
    onSelectionUpdate({ editor }) { updateToolbar(editor); },
    onTransaction({ editor }) { updateToolbar(editor); },
  });
  const toggles = { bold:'toggleBold', italic:'toggleItalic', underline:'toggleUnderline', strike:'toggleStrike',
    bulletList:'toggleBulletList', orderedList:'toggleOrderedList', blockquote:'toggleBlockquote' };
  toolbar.addEventListener('pointerdown', e => { if (e.target.closest('[data-wys]')) e.preventDefault(); });
  toolbar.addEventListener('click', e => {
    const name = e.target.closest('[data-wys]')?.dataset.wys;
    if (name?.startsWith('heading:')) editor.chain().focus().toggleHeading({ level: Number(name.split(':')[1]) }).run();
    else if (name === 'paragraph') editor.chain().focus().setParagraph().run();
    else if (toggles[name]) editor.chain().focus()[toggles[name]]().run();
  });
  function rewrite(doc, restore) {
    const cloned = structuredClone(doc);
    function walk(n) {
      if (n.type === 'image') {
        const id = n.attrs.attachmentId;
        if (!id || !Object.hasOwn(assets, id)) throw new Error('图片附件缺失，正文暂不可保存');
        n.attrs.src = restore ? id : assets[id];
      }
      for (const x of n.content || []) walk(x);
    }
    walk(cloned);
    return cloned;
  }
  return {
    begin(doc, attachmentMap) {
      assets = Object.assign(Object.create(null), attachmentMap || {});
      editor.setEditable(true);
      editor.commands.setContent(rewrite(doc, false), { errorOnInvalidContent: true, emitUpdate: false });
      // Begin at the first usable body cursor. A leading empty paragraph or
      // heading before an image is visually collapsed in the read and edit views.
      // Keep it in the source document, but don't place the cursor there.
      const current = editor.state.doc;
      const first = current.firstChild;
      const skip = first && (first.type.name === 'paragraph' || first.type.name === 'heading') &&
        first.content.size === 0 && current.childCount > 1 && current.child(1).type.name === 'image';
      const start = current.resolve(skip ? first.nodeSize : 0);
      const selection = Selection.findFrom(start, 1, true) || Selection.near(start, 1);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      updateToolbar(editor);
    },
    document: () => rewrite(editor.getJSON(), true),
    focus: () => editor.commands.focus(),
    setEditable: value => editor.setEditable(value),
    getLink: () => editor.getAttributes('link').href || '',
    applyLink(href) {
      if (!href) return editor.chain().focus().extendMarkRange('link').unsetLink().run();
      let url;
      try { url = new URL(href); } catch { return false; }
      if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return false;
      return editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    },
    reset() { editor.commands.clearContent(false); assets = Object.create(null); },
  };
}
window.LanliInboxWriter = { createWriter };
