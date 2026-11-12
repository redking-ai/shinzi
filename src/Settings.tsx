import React, { useState, useEffect } from 'react';
import './Settings.css';
import { auth } from './firebaseConfig';
import { signOut } from 'firebase/auth';
import TextStylesModal from './TextStylesModal';

interface SettingsProps {
  onBack: () => void;
}

// Custom Fortune Wheel / Spin Royal SVG matching Screenshot_20261109-185302_Chrome.jpg
const SpinRoyalIcon: React.FC<{ color?: string; size?: number }> = ({
  color = '#ffffff',
  size = 22,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'inline-block', flexShrink: 0 }}
    aria-hidden="true"
  >
    {/* Outer Wheel Ring */}
    <circle cx="12" cy="10.5" r="7.5" />
    {/* Center Hub */}
    <circle cx="12" cy="10.5" r="1.8" fill={color} />
    {/* 8 Radial Spokes */}
    <line x1="12" y1="3" x2="12" y2="8.7" />
    <line x1="12" y1="12.3" x2="12" y2="18" />
    <line x1="4.5" y1="10.5" x2="10.2" y2="10.5" />
    <line x1="13.8" y1="10.5" x2="19.5" y2="10.5" />
    <line x1="6.7" y1="5.2" x2="10.7" y2="9.2" />
    <line x1="13.3" y1="11.8" x2="17.3" y2="15.8" />
    <line x1="17.3" y1="5.2" x2="13.3" y2="9.2" />
    <line x1="10.7" y1="11.8" x2="6.7" y2="15.8" />
    {/* Top Pointer Indicator */}
    <polygon points="12,5.2 10,2 14,2" fill={color} stroke={color} strokeWidth="1" />
    {/* Stand Base & Legs */}
    <path d="M9.2 17.5 L7.5 22 M14.8 17.5 L16.5 22" />
    <line x1="5.5" y1="22" x2="18.5" y2="22" strokeWidth="2" />
  </svg>
);

const MaterialIcon: React.FC<{
  name: string;
  color?: string;
  size?: number;
  className?: string;
}> = ({ name, color = '#ffffff', size = 22, className = '' }) => (
  <span
    className={`material-symbols-outlined ${className}`}
    style={{
      fontSize: `${size}px`,
      color,
      width: `${size}px`,
      height: `${size}px`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
      userSelect: 'none',
      flexShrink: 0,
    }}
    aria-hidden="true"
  >
    {name}
  </span>
);

export default function Settings({ onBack }: SettingsProps) {
  const [devEnabled, setDevEnabled] = useState(false);
  const [showTextStyles, setShowTextStyles] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [deviceName, setDeviceName] = useState('Samsung A20');

  const devCode = 'SHINZI-DEV-2026';

  useEffect(() => {
    // Auto-detect device name
    if (typeof navigator === 'undefined') return;

    const detect = async () => {
      let detected = '';

      // Try Chrome User-Agent Client Hints
      try {
        const uad = (navigator as any).userAgentData;
        if (uad?.getHighEntropyValues) {
          const hints = await uad.getHighEntropyValues(['model']);
          if (hints?.model) {
            detected = hints.model;
          }
        }
      } catch {
        // Ignore fallback to userAgent
      }

      const ua = navigator.userAgent || '';

      if (!detected) {
        if (/SM-A20/i.test(ua) || /A20/i.test(ua)) {
          setDeviceName('Samsung A20');
          return;
        }

        const m = ua.match(/\((?:Linux;\s*)?Android[^;]*;\s*([^;)]+)\)/i);
        if (m && m[1]) {
          detected = m[1].split('Build/')[0].trim();
        }
      }

      if (detected) {
        if (/^SM-A20/i.test(detected) || /A20/i.test(detected)) {
          setDeviceName('Samsung A20');
        } else if (/^SM-/i.test(detected)) {
          setDeviceName(`Samsung ${detected}`);
        } else if (/^Pixel/i.test(detected)) {
          setDeviceName(`Google ${detected}`);
        } else if (/^Redmi|^POCO|^Mi /i.test(detected)) {
          setDeviceName(`Xiaomi ${detected}`);
        } else {
          setDeviceName(detected);
        }
        return;
      }

      if (/iPhone/i.test(ua)) setDeviceName('Apple iPhone');
      else if (/iPad/i.test(ua)) setDeviceName('Apple iPad');
      else if (/Android/i.test(ua)) setDeviceName('Samsung A20');
      else if (/Windows/i.test(ua)) setDeviceName('Windows PC');
      else if (/Macintosh/i.test(ua)) setDeviceName('Mac');
      else if (/Linux/i.test(ua)) setDeviceName('Linux Device');
      else setDeviceName('Samsung A20');
    };

    void detect();
  }, []);

  const showToast = (msg: string) => {
    setToastText(msg);
    setTimeout(() => {
      setToastText((curr) => (curr === msg ? null : curr));
    }, 2000);
  };

  const handleCopyCode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(devCode);
      }
      setCopiedCode(true);
      showToast('Developer code copied!');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      showToast('Copied: ' + devCode);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      onBack();
      window.location.reload();
    } catch {
      showToast('Failed to log out.');
    }
  };

  return (
    <div className="sh-settings-page">
      {/* Top Header */}
      <header className="sh-settings-header">
        <div className="sh-settings-header-left">
          <button
            type="button"
            className="sh-settings-back-btn"
            onClick={onBack}
            aria-label="Back to Profile"
            title="Back"
          >
            <MaterialIcon name="arrow_back" size={20} />
          </button>
          <h1 className="sh-settings-title">Settings</h1>
        </div>
        <div className="sh-settings-header-spacer" />
      </header>

      {/* Main Settings List */}
      <main className="sh-settings-content">
        {/* ==========================================================
            1. ACCOUNT
           ========================================================== */}
        <section className="sh-settings-section">
          <div className="sh-settings-section-header">
            <span className="sh-settings-section-title">ACCOUNT</span>
          </div>
          <div className="sh-settings-card">
            {/* 1. Profile */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Profile settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="account_circle" />
                </span>
                <span className="sh-settings-item-label">Profile</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 2. Privacy and Safety */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Privacy and Safety settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="lock" />
                </span>
                <span className="sh-settings-item-label">Privacy and Safety</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 3. Devices */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Connected devices')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="devices_other" />
                </span>
                <span className="sh-settings-item-label">Devices</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 4. Other Platforms */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Other platforms')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="interests" />
                </span>
                <span className="sh-settings-item-label">Other Platforms</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 5. Restricted Accounts */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Restricted accounts')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="person_cancel" />
                </span>
                <span className="sh-settings-item-label">Restricted accounts</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 6. Permitted Bots */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Permitted bots')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="smart_toy" />
                </span>
                <span className="sh-settings-item-label">Permitted bots</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 7. Notifications */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Notification settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="notifications" />
                </span>
                <span className="sh-settings-item-label">Notifications</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 8. Friends */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Friends settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="group" />
                </span>
                <span className="sh-settings-item-label">Friends</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>
          </div>
        </section>

        {/* ==========================================================
            2. PAYMENT SETTINGS
           ========================================================== */}
        <section className="sh-settings-section">
          <div className="sh-settings-section-header">
            <span className="sh-settings-section-title">PAYMENT SETTINGS</span>
          </div>
          <div className="sh-settings-card">
            {/* 9. Shop */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Shop')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="storefront" />
                </span>
                <span className="sh-settings-item-label">Shop</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 10. Spin Royal */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Spin Royal')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <SpinRoyalIcon color="#ffffff" size={22} />
                </span>
                <span className="sh-settings-item-label">Spin Royal</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 11. Spent History */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Spent history')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="history" />
                </span>
                <span className="sh-settings-item-label">Spent History</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>
          </div>
        </section>

        {/* ==========================================================
            3. APP SETTINGS
           ========================================================== */}
        <section className="sh-settings-section">
          <div className="sh-settings-section-header">
            <span className="sh-settings-section-title">APP SETTINGS</span>
          </div>
          <div className="sh-settings-card">
            {/* 12. Appearance */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Appearance settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="image" />
                </span>
                <span className="sh-settings-item-label">Appearance</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 13. Download settings */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Download settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="download" />
                </span>
                <span className="sh-settings-item-label">Download settings</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 14. APP icon */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('App icon settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="app_registration" />
                </span>
                <span className="sh-settings-item-label">APP icon</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 15. Voice */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Voice settings')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="mic" />
                </span>
                <span className="sh-settings-item-label">Voice</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 16. Text Styles */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => setShowTextStyles(true)}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="text_fields" />
                </span>
                <span className="sh-settings-item-label">Text Styles</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>
          </div>
        </section>

        {/* ==========================================================
            4. OTHERS
           ========================================================== */}
        <section className="sh-settings-section">
          <div className="sh-settings-section-header">
            <span className="sh-settings-section-title">OTHERS</span>
          </div>
          <div className="sh-settings-card">
            {/* 17. Support */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Support')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="support_agent" />
                </span>
                <span className="sh-settings-item-label">Support</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 18. Report Bugs */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Report bugs')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="bug_report" />
                </span>
                <span className="sh-settings-item-label">Report bugs</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 19. Help */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Help')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="help" />
                </span>
                <span className="sh-settings-item-label">Help</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 20. Support Us */}
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast('Support us')}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="favorite" />
                </span>
                <span className="sh-settings-item-label">Support us</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>

            {/* 21. Log Out (Red text and red icon) */}
            <button
              type="button"
              className="sh-settings-item sh-settings-item-danger"
              onClick={handleLogout}
              aria-label="Log Out"
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="logout" color="#ff4b4b" />
                </span>
                <span className="sh-settings-item-label">Log Out</span>
              </div>
              <div className="sh-settings-item-right" />
            </button>
          </div>
        </section>

        {/* ==========================================================
            5. DEVELOPER SETTINGS
           ========================================================== */}
        <section className="sh-settings-section">
          <div className="sh-settings-section-header">
            <span className="sh-settings-section-title">DEVELOPER SETTINGS</span>
            {/* Toggle switch on header right */}
            <button
              type="button"
              className={`sh-settings-toggle ${devEnabled ? 'sh-settings-toggle-on' : ''}`}
              onClick={() => {
                const next = !devEnabled;
                setDevEnabled(next);
                showToast(next ? 'Developer settings enabled' : 'Developer settings disabled');
              }}
              role="switch"
              aria-checked={devEnabled}
              aria-label="Toggle developer settings"
            >
              <span className="sh-settings-toggle-knob" />
            </button>
          </div>

          <div className={`sh-settings-card ${!devEnabled ? 'sh-settings-card-disabled' : ''}`}>
            {/* 22. App Version */}
            <div className="sh-settings-item">
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="info" />
                </span>
                <span className="sh-settings-item-label">App version</span>
              </div>
              <div className="sh-settings-item-right">
                <span className="sh-settings-item-value">0.0.1</span>
              </div>
            </div>

            {/* 23. Device (auto-detected real phone name) */}
            <div className="sh-settings-item">
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="smartphone" />
                </span>
                <span className="sh-settings-item-label">Device</span>
              </div>
              <div className="sh-settings-item-right">
                <span className="sh-settings-item-value">{deviceName}</span>
              </div>
            </div>

            {/* 24. Developer code */}
            <div className="sh-settings-item">
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="logo_dev" />
                </span>
                <span className="sh-settings-item-label">Developer code</span>
              </div>
              <div className="sh-settings-item-right">
                <button
                  type="button"
                  className={`sh-settings-copy-btn ${copiedCode ? 'sh-settings-copy-btn-copied' : ''}`}
                  onClick={devEnabled ? handleCopyCode : undefined}
                  disabled={!devEnabled}
                  title="Copy Developer Code"
                  aria-label="Copy Developer Code"
                >
                  <MaterialIcon name="content_copy" size={16} />
                  <span>{copiedCode ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ==========================================================
            6. WHAT'S NEW (from drawing 2)
           ========================================================== */}
        <section className="sh-settings-section" style={{ marginBottom: 40 }}>
          <div className="sh-settings-card">
            <button
              type="button"
              className="sh-settings-item"
              onClick={() => showToast("What's new")}
            >
              <div className="sh-settings-item-left">
                <span className="sh-settings-item-icon">
                  <MaterialIcon name="help_outline" />
                </span>
                <span className="sh-settings-item-label">What's new</span>
              </div>
              <div className="sh-settings-item-right">
                <MaterialIcon name="chevron_right" className="sh-settings-chevron" size={20} />
              </div>
            </button>
          </div>
        </section>
      </main>

      {/* Toast Alert */}
      {toastText && <div className="sh-settings-toast">{toastText}</div>}

      {/* Text Styles Modal (20261112_175229.jpg) */}
      {showTextStyles && (
        <TextStylesModal
          onBack={() => setShowTextStyles(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
