import { useApp } from '../state/store';
import { chain } from '../scene/CameraDirector';
import { IconArrow } from './icons';

/** Act I overlay: restrained editorial titles and the single invitation. */
export function HeroTitles() {
  const goTo = useApp((s) => s.goTo);
  const ready = useApp((s) => s.ready);
  const enter = () => {
    chain.next = 'interior';
    goTo('sculptural');
  };
  return (
    <section className={`hero ${ready ? 'in' : ''}`} aria-label="Introduction">
      <p className="eyebrow">Orbital Bloom 02 <span>·</span> a one-of-one for Angelo</p>
      <h1>Liquid<br />Frequency</h1>
      <p className="lede">Three expressive pressure nodes</p>
      <div className="hero-actions">
        <button className="cta" onClick={enter}>
          <span>Enter the instrument</span><IconArrow />
        </button>
        <button className="ghost" onClick={() => goTo('sculptural')}>Select Node 01</button>
      </div>
      <p className="hero-hint">Drag to orbit · tap a node to hear it · it notices your hand</p>
    </section>
  );
}
