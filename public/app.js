/**
 * QR Menu Maker — tiny client script (dashboard only).
 * - Copy-to-clipboard buttons: [data-copy]
 * - Download QR as PNG: [data-qr-png] (fetches the SVG, draws it on a canvas, downloads a PNG)
 * - Print QR: [data-print-qr]
 * - Add another price row: [data-add-price]
 * - Delete confirmations: form[data-confirm]
 */
(function () {
  'use strict';

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-copy]');
    if (el) {
      var text = el.getAttribute('data-copy') || '';
      var done = function () {
        el.textContent = 'Copied';
        setTimeout(function () { el.textContent = 'Copy link'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else {
        fallbackCopy(text);
        done();
      }
      return;
    }

    var pngBtn = ev.target.closest('[data-qr-png]');
    if (pngBtn) {
      downloadQrPng(pngBtn.getAttribute('data-qr-png') || '', pngBtn.getAttribute('data-filename') || 'qr.png');
      return;
    }

    if (ev.target.closest('[data-print-qr]')) {
      window.print();
      return;
    }

    var addBtn = ev.target.closest('[data-add-price]');
    if (addBtn) {
      var wrap = document.getElementById('price-rows');
      if (!wrap) return;
      var first = wrap.querySelector('.price-row');
      if (!first) return;
      var clone = first.cloneNode(true);
      clone.querySelectorAll('input').forEach(function (input) { input.value = ''; });
      wrap.appendChild(clone);
    }
  });

  document.addEventListener('submit', function (ev) {
    var form = ev.target.closest('form[data-confirm]');
    if (form && !window.confirm(form.getAttribute('data-confirm') || 'Are you sure?')) {
      ev.preventDefault();
    }
  });

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function downloadQrPng(svgUrl, filename) {
    fetch(svgUrl)
      .then(function (res) { return res.text(); })
      .then(function (svgText) {
        var img = new Image();
        var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        img.onload = function () {
          var size = 1024;
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (pngBlob) {
            if (!pngBlob) return;
            var a = document.createElement('a');
            a.href = URL.createObjectURL(pngBlob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
          }, 'image/png');
        };
        img.onerror = function () { URL.revokeObjectURL(url); };
        img.src = url;
      });
  }
})();
