const intro = document.getElementById('startupIntro');

if (intro) {
  const force = new URLSearchParams(location.search).get('intro') === '1';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let alreadySeen = false;
  try { alreadySeen = sessionStorage.getItem('anotherCupIntroSeen') === '1'; } catch {}
  if (!force && (reduceMotion || alreadySeen)) {
    intro.remove();
  } else {
    try { sessionStorage.setItem('anotherCupIntroSeen', '1'); } catch {}
    let finished = false;
    const onKeydown = event => {
      if (event.key === 'Escape') intro.querySelector('#introSkip').click();
    };
    document.addEventListener('keydown', onKeydown);
    const finish = () => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKeydown);
      intro.remove();
      if (document.activeElement?.id === 'introSkip') document.activeElement.blur();
    };
    intro.addEventListener('animationend', event => {
      if (event.target === intro) finish();
    });
    const fallback = setTimeout(finish, 3500);
    intro.querySelector('#introSkip').addEventListener('click', () => {
      intro.classList.add('intro-skipping');
      clearTimeout(fallback);
      setTimeout(finish, 200);
    });
    if (getComputedStyle(intro).visibility === 'hidden') finish();
  }
}
