'use strict';
const { Editor } = require('@tiptap/core');
const { DOMParser, Fragment, Slice } = require('@tiptap/pm/model');
const { Selection, TextSelection } = require('@tiptap/pm/state');
const { extensions } = require('../inbox-document-schema');
const { LIMIT_IMAGE, LIMIT_DRAFT, LIMIT_COUNT, MIME, embeddedImage, standaloneHttpLink } = require('./inbox-paste-policy');

function createWriter(element, toolbar, pasteNotice = () => {}) {
  let assets = Object.create(null);
  let draftAssets = Object.create(null);
  let pendingPastes = new Set();
  let pasteQueue = Promise.resolve();

  const readImage = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(embeddedImage(reader.result));
    reader.onerror = () => reject(new Error('无法读取这张剪贴板图片'));
    reader.readAsDataURL(file);
  });
  function pasteSelection(view) {
    const selection = view.dom.ownerDocument.getSelection();
    if (!selection?.anchorNode || !selection.focusNode ||
        !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return view.state.selection;
    try {
      const doc = view.state.doc;
      const head = doc.resolve(view.posAtDOM(selection.focusNode, selection.focusOffset));
      const anchor = doc.resolve(view.posAtDOM(selection.anchorNode, selection.anchorOffset));
      if (anchor.parent.inlineContent && head.parent.inlineContent) return TextSelection.between(anchor, head);
    } catch { /* fall back to the last editor selection */ }
    return view.state.selection;
  }
  function handleEditorPaste(view, event) {
    const source = event.clipboardData;
    if (!source || !view.editable) return false;
    const text = source.getData('text/plain');
    const rawHtml = source.getData('text/html');
    const html = rawHtml !== text ? rawHtml : '';
    const files = Array.from(source.files || []).filter(file => file.type.startsWith('image/'));
    if (!files.length && !html) {
      const url = standaloneHttpLink(text);
      if (url) {
        event.preventDefault();
        const {schema} = view.state;
        const link = schema.text(url, [schema.marks.link.create({href: url})]);
        view.dispatch(view.state.tr.setSelection(pasteSelection(view)).replaceSelectionWith(link, false)
          .setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
        return true;
      }
    }
    if (!files.length && !/<img[\s/>]/i.test(html)) return false;
    event.preventDefault();
    const session = pendingPastes;
    const paste = { bookmark: pasteSelection(view).getBookmark() };
    session.add(paste);
    pasteNotice('正在读入剪贴板图片…');
    pasteQueue = pasteQueue.then(async () => {
      if (session !== pendingPastes) return;
      let skipped = false;
      const additions = Object.create(null);
      let bytes = Object.values(draftAssets).reduce((total, asset) => total + asset.bytes, 0);
      let count = Object.keys(draftAssets).length;
      const attach = (node, image) => {
        if (!image || count >= LIMIT_COUNT || bytes + image.bytes > LIMIT_DRAFT) { skipped = true; return false; }
        const id = 'draft-' + crypto.randomUUID();
        additions[id] = image;
        bytes += image.bytes;
        count += 1;
        node.setAttribute('src', image.url);
        node.setAttribute('data-attachment-id', id);
        return true;
      };
      const template = document.createElement('template');
      // An inert template doesn't fetch remote resources. Only accepted local
      // bytes can become images in the live editor.
      if (html) template.innerHTML = html;
      else for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
        if (!line && !text) continue;
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        template.content.append(paragraph);
      }
      const images = Array.from(template.content.querySelectorAll('img'));
      let embeds = 0;
      for (const image of images) {
        const candidate = embeddedImage(image.getAttribute('src'));
        const alt = (image.getAttribute('alt') || '').slice(0, 500);
        const title = (image.getAttribute('title') || '').slice(0, 500);
        for (const attr of Array.from(image.attributes)) image.removeAttribute(attr.name);
        if (alt) image.setAttribute('alt', alt);
        if (title) image.setAttribute('title', title);
        if (candidate && attach(image, candidate)) embeds += 1;
      }
      const unresolved = images.filter(image => !image.hasAttribute('data-attachment-id'));
      // A native bitmap can be another encoding of an embedded HTML image.
      // Use it only as a fallback for the one unresolved source or for bitmap-only clipboard data.
      if (!embeds && images.length <= 1) {
        const candidates = images.length ? files.slice(0, 1) : files.slice(0, LIMIT_COUNT);
        if (!images.length && files.length > candidates.length) skipped = true;
        for (const file of candidates) {
          const node = unresolved.shift() || document.createElement('img');
          const data = file.size > 0 && file.size <= LIMIT_IMAGE && MIME.test(file.type) ? await readImage(file) : null;
          if (session !== pendingPastes) return;
          if (attach(node, data)) { if (!node.parentNode) template.content.append(node); }
          else node.remove();
        }
      }
      for (const image of unresolved) { image.remove(); skipped = true; }
      if (!template.content.childNodes.length && text) template.content.append(document.createTextNode(text));
      if (session !== pendingPastes) return;
      session.delete(paste);
      const slice = DOMParser.fromSchema(view.state.schema).parseSlice(template.content);
      if (slice.size) {
        Object.assign(draftAssets, additions);
        const target = paste.bookmark.resolve(view.state.doc);
        const liveSelection = pasteSelection(view);
        const transaction = view.state.tr.setSelection(target).replaceSelection(slice).setMeta('paste', true).setMeta('uiEvent', 'paste');
        if (liveSelection.eq(target)) transaction.scrollIntoView();
        else transaction.setSelection(liveSelection.getBookmark().map(transaction.mapping).resolve(transaction.doc));
        view.dispatch(transaction);
      }
      pasteNotice(skipped ? '部分图片未粘贴：仅支持剪贴板 PNG 和 JPEG，或图片超过大小限制。原内容未受影响。' : '');
    }).catch(() => {
      if (session !== pendingPastes) return;
      session.delete(paste);
      pasteNotice('无法粘贴这张图片。原内容未受影响。');
    });
    return true;
  }

  function updateToolbar(editor) {
    for (const control of toolbar.querySelectorAll('[data-wys]')) {
      const [name, level] = control.dataset.wys.split(':');
      control.setAttribute('aria-pressed', String(editor.isActive(name, level ? { level: Number(level) } : undefined)));
    }
  }
  const editor = new Editor({
    element, extensions: extensions({ previewImages: true }), injectCSS: false,
    editorProps: {
      attributes: { 'aria-label': '收纳正文', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false' },
      handleDOMEvents: { paste: handleEditorPaste },
      clipboardTextParser(text, context) {
        const schema = context.doc.type.schema;
        const blocks = text.replace(/\r\n?/g, '\n').split('\n')
          .map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
        return new Slice(Fragment.fromArray(blocks), 0, 0);
      },
      transformPastedHTML(html) {
        // Any image outside the clipboard path above must not become a live URL.
        const template = document.createElement('template');
        template.innerHTML = html;
        for (const n of template.content.querySelectorAll('img')) n.remove();
        return template.innerHTML;
      },
    },
    onSelectionUpdate({ editor }) { updateToolbar(editor); },
      onTransaction({ editor, transaction }) {
      for (const paste of pendingPastes) paste.bookmark = paste.bookmark.map(transaction.mapping);
      updateToolbar(editor);
    },
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
  function rewrite(doc, restore, attachments = null) {
    const cloned = structuredClone(doc);
    function walk(n) {
      if (n.type === 'image') {
        const id = n.attrs.attachmentId;
        const pending = id && draftAssets[id];
        if (!pending && (!id || !Object.hasOwn(assets, id))) throw new Error('图片附件缺失，正文暂不可保存');
        if (pending && attachments) attachments[id] = pending.url;
        n.attrs.src = restore ? id : pending?.url || assets[id];
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
    saveDraft() {
      const newAttachments = Object.create(null);
      const document = rewrite(editor.getJSON(), true, newAttachments);
      return Object.keys(newAttachments).length ? { document, newAttachments } : { document };
    },
    hasPendingPaste: () => pendingPastes.size > 0,
    focus: () => editor.commands.focus(),
    focusForOpen() {
      // Focus as part of opening, not in a later animation frame that could
      // take focus back from a title the user has already clicked.
      editor.view.focus();
      editor.view.dispatch(editor.state.tr.scrollIntoView());
    },
    setEditable: value => editor.setEditable(value),
    getLink: () => editor.getAttributes('link').href || '',
    applyLink(href) {
      if (!href) return editor.chain().focus().extendMarkRange('link').unsetLink().run();
      let url;
      try { url = new URL(href); } catch { return false; }
      if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return false;
      return editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    },
    reset() {
      pendingPastes = new Set();
      pasteQueue = Promise.resolve();
      editor.commands.clearContent(false);
      assets = Object.create(null);
      draftAssets = Object.create(null);
    },
  };
}
window.LanliInboxWriter = { createWriter };
