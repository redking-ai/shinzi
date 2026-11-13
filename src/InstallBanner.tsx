import React, { useState, useEffect } from 'react';

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
    );
  });
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState<boolean>(false);

  useEffect(() => {
    if (!isStandalone && !isDismissed) {
      document.documentElement.style.setProperty('--shinzi-banner-h', '52px');
    } else {
      document.documentElement.style.setProperty('--shinzi-banner-h', '0px');
    }
    return () => {
      document.documentElement.style.setProperty('--shinzi-banner-h', '0px');
    };
  }, [isStandalone, isDismissed]);

  useEffect(() => {
    // Check standalone mode dynamically
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://');

      setIsStandalone(standalone);
    };

    checkStandalone();

    const mql = window.matchMedia('(display-mode: standalone)');
    mql.addEventListener('change', checkStandalone);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mql.removeEventListener('change', checkStandalone);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isStandalone || isDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        if (choiceResult?.outcome === 'accepted') {
          setIsStandalone(true);
        }
        setDeferredPrompt(null);
      } catch (err) {
        console.warn('Install prompt error:', err);
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  return (
    <>
      <div style={bannerStyles.container}>
        <div style={bannerStyles.left}>
          <img
            src="/icon-192.png"
            alt="Shinzi App"
            style={bannerStyles.appIcon}
          />
          <div style={bannerStyles.textCol}>
            <span style={bannerStyles.title}>Install Shinzi</span>
            <span style={bannerStyles.subtitle}>Install app for the best experience</span>
          </div>
        </div>

        <div style={bannerStyles.right}>
          <button
            type="button"
            onClick={handleInstallClick}
            style={bannerStyles.installBtn}
          >
            Install
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close install banner"
            style={bannerStyles.closeBtn}
          >
            ✕
          </button>
        </div>
      </div>

      {showGuide && (
        <div style={modalStyles.overlay} onClick={() => setShowGuide(false)}>
          <div style={modalStyles.content} onClick={(e) => e.stopPropagation()}>
            <div style={modalStyles.header}>
              <img src="/icon-192.png" alt="Shinzi Logo" style={modalStyles.logo} />
              <h3 style={modalStyles.title}>Install Shinzi App</h3>
            </div>
            <p style={modalStyles.body}>
              To install Shinzi on your device:
            </p>
            <ol style={modalStyles.list}>
              <li style={modalStyles.listItem}>
                <strong>Android Chrome:</strong> Tap the <strong>⋮ (Menu)</strong> at the top right, then tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
              </li>
              <li style={modalStyles.listItem}>
                <strong>iPhone Safari:</strong> Tap the <strong>Share</strong> button at the bottom, then scroll down and tap <strong>Add to Home Screen</strong>.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              style={modalStyles.closeModalBtn}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const bannerStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'sticky',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    backgroundColor: '#111214',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 14px',
    boxSizing: 'border-box',
    gap: 8,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: 1,
  },
  appIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    objectFit: 'cover',
    flexShrink: 0,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
  },
  textCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtitle: {
    color: '#949ba4',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1.2,
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  installBtn: {
    backgroundColor: '#FFFFFF',
    color: '#000000',
    border: 'none',
    borderRadius: 16,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#949ba4',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
};

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    zIndex: 100000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    boxSizing: 'border-box',
    backdropFilter: 'blur(4px)',
  },
  content: {
    backgroundColor: '#1e1f22',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    maxWidth: 380,
    width: '100%',
    padding: 20,
    boxSizing: 'border-box',
    color: '#FFFFFF',
    boxShadow: '0 12px 36px rgba(0,0,0,0.8)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
  },
  body: {
    margin: '0 0 12px 0',
    fontSize: 13,
    color: '#dbdee1',
    lineHeight: 1.4,
  },
  list: {
    margin: '0 0 18px 0',
    paddingLeft: 20,
    fontSize: 13,
    color: '#b5bac1',
    lineHeight: 1.5,
  },
  listItem: {
    marginBottom: 8,
  },
  closeModalBtn: {
    width: '100%',
    backgroundColor: '#5865f2',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 20,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
