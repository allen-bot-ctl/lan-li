'use strict';
const StarterKit = require('@tiptap/starter-kit').default;
const Image = require('@tiptap/extension-image').default;
const Attachment = Image.extend({
  addAttributes() {
    return {
      ...this.parent(),
      attachmentId: {
        default: null,
        parseHTML: node => node.getAttribute('data-attachment-id'),
        renderHTML: attrs => attrs.attachmentId ? { 'data-attachment-id': attrs.attachmentId } : {},
      },
    };
  },
});
const extensions = ({ previewImages = false } = {}) => [StarterKit.configure({ trailingNode: false, link: { openOnClick: false } }), Attachment.configure({ allowBase64: previewImages })];
module.exports = { extensions };
