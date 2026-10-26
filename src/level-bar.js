// A bar of equal segments with a marker on a divider, shared by the Mac page and the phone.
// The marker can sit on any divider except the left edge; the bar is filled up to it.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// labels: one name per segment. onChange(level) gets 0 for the first segment up to labels.length - 1.
export function createLevelBar(box, labels, onChange, ariaLabel) {
  const count = labels.length;
  box.classList.add('level-bar');
  const track = el('div', 'level-track');
  const fill = el('span', 'level-fill');
  const marker = el('span', 'level-marker');
  track.append(fill);
  for (let i = 0; i <= count; i++) {
    const divider = el('span', i === 0 ? 'level-sep edge' : 'level-sep');
    divider.style.left = `${(i / count) * 100}%`;
    track.append(divider);
  }
  track.append(marker);
  track.setAttribute('role', 'slider');
  track.tabIndex = 0;
  track.setAttribute('aria-label', ariaLabel);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(count - 1));

  const names = el('div', 'level-names');
  const buttons = labels.map((name, index) => {
    const button = el('button', '', name);
    button.type = 'button';
    button.onclick = () => choose(index);
    names.append(button);
    return button;
  });
  box.replaceChildren(track, names);

  let current = count - 1;
  function set(level) {
    current = level;
    const share = `${((level + 1) / count) * 100}%`;
    fill.style.width = share;
    marker.style.left = share;
    track.setAttribute('aria-valuenow', String(level));
    track.setAttribute('aria-valuetext', labels[level]);
    buttons.forEach((button, index) => button.classList.toggle('on', index <= level));
  }
  function choose(level) {
    const next = Math.min(count - 1, Math.max(0, level));
    if (next === current) return;
    set(next);
    onChange(next);
  }
  // The nearest divider to the pointer, never the left edge.
  const fromPointer = event => {
    const rect = track.getBoundingClientRect();
    choose(Math.round(((event.clientX - rect.left) / rect.width) * count) - 1);
  };
  track.onpointerdown = event => { track.setPointerCapture(event.pointerId); fromPointer(event); };
  track.onpointermove = event => { if (track.hasPointerCapture(event.pointerId)) fromPointer(event); };
  track.onkeydown = event => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (step) { event.preventDefault(); choose(current + step); }
    else if (event.key === 'Home') choose(0);
    else if (event.key === 'End') choose(count - 1);
  };
  return { set };
}
