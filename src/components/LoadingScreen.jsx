// The loading screen: an animated mascot (the cube creature that folds into the
// logo), the title, and the progress bar. With "reduce motion" on, the GIF is
// swapped for the static logo (see the .loading-* rules in index.css).
import logo from '../assets/logo.png';
import mascot from '../assets/loading-mascot.gif';

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-screen-content">
        <img className="loading-mascot" src={mascot} alt="" draggable={false} />
        <img className="loading-screen-logo loading-static" src={logo} alt="" draggable={false} />
        <h1 className="loading-screen-title">Zorya Launcher</h1>
        <div className="loading-bar-track">
          <div className="loading-bar-fill" />
        </div>
      </div>
    </div>
  );
}
