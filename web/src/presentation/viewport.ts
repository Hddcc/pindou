export function trackViewport() {
  const viewport = window.visualViewport;
  function update() {
    const height = viewport && viewport.scale === 1 ? viewport.height : window.innerHeight;
    if (height > 0) document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  }
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  viewport?.addEventListener('resize', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    viewport?.removeEventListener('resize', update);
  };
}
