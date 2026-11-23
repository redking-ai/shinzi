import { Icon } from '@iconify/react';
import heroImg from './assets/hero.png';
import { SupportedPlatformId, getPlatformMeta } from './spotifyService';

interface PlatformConfirmationModalProps {
  platformId?: SupportedPlatformId | string;
  onClose: () => void;
}

export default function PlatformConfirmationModal({
  platformId = 'spotify',
  onClose,
}: PlatformConfirmationModalProps) {
  const meta = getPlatformMeta(platformId);

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

  const getPlatformColor = () => {
    if (platformId === 'spotify') return '#1ed760';
    if (platformId === 'youtube') return '#ff0000';
    if (platformId === 'facebook') return '#1877f2';
    return '#ffffff';
  };

  return (
    <div className="sh-sp-confirm-overlay" onClick={handleClose}>
      <div className="sh-sp-confirm-card" onClick={(e) => e.stopPropagation()}>
        {/* Three items in center row: Shinzi White Hero Logo + Link Chain + Platform Icon */}
        <div className="sh-sp-confirm-icons-row">
          <div className="sh-sp-confirm-hero-wrap">
            <img src={heroImg} alt="Shinzi" className="sh-sp-confirm-hero-img" />
          </div>

          <div className="sh-sp-confirm-chain-wrap">
            <Icon icon="lucide:link" width={28} height={28} color="#949ba4" />
          </div>

          <div className="sh-sp-confirm-spotify-wrap">
            <Icon icon={meta.icon} width={48} height={48} />
          </div>
        </div>

        {/* Text: Successfully connected your [Platform] account to Shinzi */}
        <h2 className="sh-sp-confirm-title">
          Successfully connected your <span style={{ color: getPlatformColor() }}>{meta.name}</span> account to Shinzi
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
