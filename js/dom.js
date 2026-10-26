/* Tiny DOM helpers shared by every module. -> window.MacDOM */
(function () {
  'use strict';

  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
  }

  function append(node, children) {
    children.flat(Infinity).forEach((child) => {
      if (child == null || child === false) return;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  // h('button', { class: 'btn', onclick: fn, html: '<svg…>' }, 'label', [more children])
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === false || value == null) return;
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'html') node.innerHTML = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    return append(node, children);
  }

  // Storage throws in some private modes; every access goes through these.
  function readStore(kind, key) {
    try {
      return window[kind].getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeStore(kind, key, value) {
    try {
      if (value == null) window[kind].removeItem(key);
      else window[kind].setItem(key, value);
    } catch (err) {
      /* Storage unavailable: the setting just won't persist. */
    }
  }

  window.MacDOM = Object.freeze({ h, esc, append, readStore, writeStore });
})();
