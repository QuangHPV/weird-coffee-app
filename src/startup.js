const intro = document.getElementById('startupIntro');

if (intro && document.documentElement.classList.contains('warm-entry')) intro.remove();
else if (intro) {
  let finished = false;
  const skip = intro.querySelector('#introSkip');
  const onKeydown = event => {
    if (event.key === 'Escape') skip.click();
  };
  document.addEventListener('keydown', onKeydown);
  const finish = () => {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKeydown);
    intro.remove();
  };
  intro.addEventListener('animationend', event => {
    if (event.target === intro) finish();
  });
  const fallback = setTimeout(finish, 3500);
  skip.addEventListener('click', () => {
    intro.classList.add('intro-skipping');
    clearTimeout(fallback);
    setTimeout(finish, 200);
  });
  if (getComputedStyle(intro).visibility === 'hidden') finish();
}
