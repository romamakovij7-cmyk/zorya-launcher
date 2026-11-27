// The loading screen: our pink Zorya mascot animated with CSS (no GIF),
// the title, and the progress bar. Reduce motion disables the animation.
import logo from '../assets/logo.png';

export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-screen-content">
        <div className="loading-avatar">
          <span className="loading-spark spark-1" />
          <span className="loading-spark spark-2" />
          <span className="loading-spark spark-3" />
          <img className="loading-logo-anim" src={logo} alt="" draggable={false} />
          <span className="loading-avatar-shadow" />
        </div>
        <h1 className="loading-screen-title">Zorya Launcher</h1>
        <div className="loading-bar-track">
          <div className="loading-bar-fill" />
        </div>
      </div>
    </div>
  );
}
