import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

// Project descriptions come from strangers (Modrinth markdown with inline
// HTML, CurseForge HTML), and this window can talk to the launcher's backend —
// so everything is sanitised: no scripts, frames, forms, inline styles or
// event handlers, only http(s)/mailto links and http(s)/data images.
const FORBID_TAGS = ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'script', 'link', 'meta', 'base'];
const FORBID_ATTR = ['style', 'srcset', 'formaction', 'action'];

let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('href');
        node.removeAttribute('target');
      }
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) node.remove();
      else {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
        node.setAttribute('referrerpolicy', 'no-referrer');
      }
    }
  });
}

export function sanitizeHtml(html) {
  ensureHooks();
  return DOMPurify.sanitize(String(html || ''), { FORBID_TAGS, FORBID_ATTR, ALLOW_DATA_ATTR: false });
}

// YouTube embeds can't be shown inline — turn them into a plain link.
function replaceEmbeds(html) {
  return html.replace(
    /<iframe[^>]+src=["']https?:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/([\w-]+)[^"']*["'][^>]*>\s*(?:<\/iframe>)?/gi,
    (m, id) => `<p><a href="https://www.youtube.com/watch?v=${id}">▶ Видео на YouTube</a></p>`,
  );
}

export function renderMarkdown(md) {
  return sanitizeHtml(replaceEmbeds(marked.parse(String(md || ''))));
}

export function renderHtml(html) {
  return sanitizeHtml(replaceEmbeds(String(html || '')));
}
