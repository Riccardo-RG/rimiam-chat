const shots = JSON.parse(document.getElementById('shots').textContent);
const byId = new Map(shots.map(shot => [shot.id, shot]));
const viewer = document.getElementById('viewer');
const filter = document.getElementById('filter');
let active = null;
let opener = null;
let priorHash = '';
function selected() {
  return shots.filter(shot => !filter.value || shot.group === filter.value);
}
function closeViewer() {
  history.replaceState(null, '', location.pathname + location.search + priorHash);
  viewer.close();
}
function showShot(id) {
  const shot = byId.get(id);
  if (!shot) {
    if (viewer.open) viewer.close();
    return;
  }
  if (filter.value && filter.value !== shot.group) {
    filter.value = '';
    filter.dispatchEvent(new Event('change'));
  }
  active = shot;
  const list = selected();
  const pos = list.indexOf(shot);
  document.getElementById('position').textContent = shot.group + ' · ' + (pos + 1) + ' di ' + list.length;
  document.getElementById('shot-title').textContent = shot.title;
  document.getElementById('caption').textContent = shot.caption;
  const image = document.getElementById('original');
  image.src = 'screens/' + shot.file;
  image.alt = shot.title;
  document.getElementById('full').href = image.src;
  document.getElementById('prev').disabled = pos === 0;
  document.getElementById('next').disabled = pos === list.length - 1;
  if (!viewer.open) viewer.showModal();
}
function navigate(step) {
  const list = selected();
  const target = list[list.indexOf(active) + step];
  if (target) {
    history.replaceState(null, '', '#vista-' + target.id);
    showShot(target.id);
  }
}
function sync() { showShot(location.hash.startsWith('#vista-') ? location.hash.slice('#vista-'.length) : ''); }
document.addEventListener('click', event => {
  const anchor = event.target.closest('a[data-shot]');
  if (!anchor || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  opener = anchor;
  priorHash = location.hash.startsWith('#vista-') ? '' : location.hash;
  history.replaceState(null, '', anchor.hash);
  showShot(anchor.dataset.shot);
});
viewer.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
viewer.addEventListener('close', () => { if (opener?.isConnected) opener.focus({preventScroll:true}); opener = null; });
document.getElementById('close').onclick = closeViewer;
document.getElementById('prev').onclick = () => navigate(-1);
document.getElementById('next').onclick = () => navigate(1);
document.addEventListener('keydown', event => {
  if (!viewer.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
filter.addEventListener('change', () => {
  for (const group of document.querySelectorAll('[data-journey]')) {
    group.hidden = Boolean(filter.value) && group.dataset.journey !== filter.value;
  }
  document.getElementById('count').textContent = selected().length + ' schermate visibili';
});
window.addEventListener('hashchange', sync);
sync();
