/* Local image map: no map service or network connection is used. */
(() => {
  'use strict';
  window.Fleet.mountRouteMap = function (viewport) {
    if (!viewport) return;
    const img = viewport.querySelector('.route-map-image');
    const output = viewport.querySelector('.route-map-scale');
    const abort = new AbortController();
    const signal = abort.signal;
    let width = 0, height = 0, fit = 1, zoom = 1, x = 0, y = 0, drag = null;
    let naturalWidth = Number(img.getAttribute('width')) || 2824;
    let naturalHeight = Number(img.getAttribute('height')) || 2028, ready = false, widthFitted = true;
    const minZoom = 1, maxZoom = 6;

    function constrain() {
      const imageWidth = naturalWidth * fit * zoom, imageHeight = naturalHeight * fit * zoom;
      const cx = (width - imageWidth) / 2, cy = (height - imageHeight) / 2;
      // Keep the image reachable while still allowing a drag in the fitted view.
      const dx = Math.max(width * .2, (imageWidth - width) / 2);
      const dy = Math.max(height * .2, (imageHeight - height) / 2);
      x = Math.max(cx - dx, Math.min(cx + dx, x));
      y = Math.max(cy - dy, Math.min(cy + dy, y));
    }
    function paint() {
      constrain();
      img.style.transform = `translate(${x}px, ${y}px) scale(${fit * zoom})`;
      output.textContent = Math.round(zoom * 100) + '%';
      output.setAttribute('aria-label', '地图缩放 ' + Math.round(zoom * 100) + '%');
      viewport.querySelector('[data-map-control="out"]').disabled = zoom <= minZoom + .001;
      viewport.querySelector('[data-map-control="in"]').disabled = zoom >= maxZoom - .001;
      viewport.dataset.zoom = zoom.toFixed(3);
    }
    function reset() {
      widthFitted = true;
      zoom = 1;
      x = (width - naturalWidth * fit) / 2;
      y = (height - naturalHeight * fit) / 2;
      paint();
    }
    function resize() {
      const nextWidth = viewport.clientWidth, nextHeight = viewport.clientHeight;
      if (!nextWidth || !nextHeight) return;
      const centerX = (width / 2 - x) / (fit * zoom);
      const centerY = (height / 2 - y) / (fit * zoom);
      width = nextWidth; height = nextHeight;
      fit = width / naturalWidth;
      if (!ready || widthFitted) { ready = true; reset(); }
      else { x = width / 2 - centerX * fit * zoom; y = height / 2 - centerY * fit * zoom; paint(); }
    }
    function zoomAt(next, ax = width / 2, ay = height / 2) {
      next = Math.max(minZoom, Math.min(maxZoom, next));
      if (next === zoom) return;
      widthFitted = false;
      const ratio = next / zoom;
      x = ax - (ax - x) * ratio;
      y = ay - (ay - y) * ratio;
      zoom = next; paint();
    }
    viewport.addEventListener('wheel', event => {
      if (event.target.closest('.route-map-controls')) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      zoomAt(zoom * Math.exp(-Math.max(-300, Math.min(300, pixels)) * .002), event.clientX - rect.left, event.clientY - rect.top);
    }, {passive:false, signal});
    viewport.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || event.target.closest('.route-map-controls')) return;
      event.preventDefault();
      viewport.focus({preventScroll:true});
      drag = {id:event.pointerId, px:event.clientX, py:event.clientY, x, y};
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    }, {signal});
    viewport.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      widthFitted = false;
      x = drag.x + event.clientX - drag.px;
      y = drag.y + event.clientY - drag.py;
      paint();
    }, {signal});
    function stop(event) {
      if (!drag || (event && event.pointerId !== drag.id)) return;
      const id = drag.id; drag = null;
      if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      viewport.classList.remove('is-dragging');
    }
    ['pointerup','pointercancel','lostpointercapture'].forEach(name => viewport.addEventListener(name, stop, {signal}));
    viewport.addEventListener('click', event => {
      const control = event.target.closest('[data-map-control]');
      if (!control) return;
      if (control.dataset.mapControl === 'reset') reset();
      else zoomAt(zoom * (control.dataset.mapControl === 'in' ? 1.25 : .8));
    }, {signal});
    viewport.addEventListener('dblclick', event => {
      if (event.target.closest('.route-map-controls')) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(zoom * 1.5, event.clientX - rect.left, event.clientY - rect.top);
    }, {signal});
    viewport.addEventListener('keydown', event => {
      if (event.target !== viewport) return;
      if (!['+','=','-','0','Home','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === '+' || event.key === '=') zoomAt(zoom * 1.25);
      else if (event.key === '-') zoomAt(zoom * .8);
      else if (event.key === '0' || event.key === 'Home') reset();
      else { widthFitted = false; x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0; y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0; paint(); }
    }, {signal});
    img.addEventListener('load', () => {
      naturalWidth = img.naturalWidth; naturalHeight = img.naturalHeight;
      img.style.width = naturalWidth + 'px'; img.style.height = naturalHeight + 'px';
      ready = false;
      resize();
    }, {signal});
    if (img.complete && img.naturalWidth) { naturalWidth = img.naturalWidth; naturalHeight = img.naturalHeight; }
    img.style.width = naturalWidth + 'px'; img.style.height = naturalHeight + 'px';
    const observer = new ResizeObserver(resize);
    observer.observe(viewport); resize();
    const previousCleanup = window.Fleet.cleanup;
    window.Fleet.cleanup = () => { stop(); abort.abort(); observer.disconnect(); previousCleanup?.(); };
  };
})();
