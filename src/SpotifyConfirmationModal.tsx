import { Icon } from '@iconify/react';
import heroImg from './assets/hero.png';

interface SpotifyConfirmationModalProps {
  onClose: () => void;
}

export default function SpotifyConfirmationModal({
  onClose,
}: SpotifyConfirmationModalProps) {
  const handleClose = () => {
    if (typeof window !== 'undefined') {
      try {
        window.close();
      } catch {}
      try {
        window.location.href = 'shinzi://platforms';
      } catch {}
    }
    onClose();
  };

  return (
    <div className="sh-sp-confirm-overlay" onClick={handleClose}>
      <div className="sh-sp-confirm-card" onClick={(e) => e.stopPropagation()}>
        {/* Three items in center row: Shinzi White Hero Logo + Link Chain + Spotify Icon */}
        <div className="sh-sp-confirm-icons-row">
          <div className="sh-sp-confirm-hero-wrap">
            <img src={heroImg} alt="Shinzi" className="sh-sp-confirm-hero-img" />
          </div>

          <div className="sh-sp-confirm-chain-wrap">
            <Icon icon="lucide:link" width={28} height={28} color="#949ba4" />
          </div>

          <div className="sh-sp-confirm-spotify-wrap">
            <Icon icon="logos:spotify-icon" width={48} height={48} />
          </div>
        </div>

        {/* Text exactly requested: Successfully connected your Spotify account to Shinzi */}
        <h2 className="sh-sp-confirm-title">
          Successfully connected your <span className="sh-sp-green">Spotify</span> account to Shinzi
        </h2>

        {/* Description: You can hit close to return to Shinzi */}
        <p className="sh-sp-confirm-desc">
          You can hit close to return to Shinzi
        </p>

        <button
          type="button"
          className="sh-sp-confirm-close-btn"
          onClick={handleClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
