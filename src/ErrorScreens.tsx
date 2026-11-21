import React, { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from './firebaseConfig';

// Fallback SVGs in case network is down and Iconify CDN is unreachable
export const InternetErrorIcon = ({ size = 36, color = '#f59e0b' }: { size?: number; color?: string }) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 32 32" fill={color}>
      <path
        fill="currentColor"
        d="M30.47 16.005H32v6.09h-1.53Zm-1.52 6.09h1.52v1.53h-1.52Zm0-7.62h1.52v1.53h-1.52Zm-1.52 9.15h1.52v1.52h-1.52Zm0-10.67h1.52v1.52h-1.52ZM3.05 25.145h24.38v1.52H3.05Zm21.33-13.71h3.05v1.52h-3.05Zm-1.53-1.53h1.53v1.53h-1.53Zm-1.52 7.62h1.52v1.52h-1.52Zm0-3.05h1.52v1.53h-1.52Zm0-6.09h1.52v1.52h-1.52Zm-1.52 7.62h1.52v1.52h-1.52Zm-1.53 1.52h1.53v1.52h-1.53Zm0-3.05h1.53v1.53h-1.53Zm0-7.62h3.05v1.53h-3.05Zm-4.57 15.24h3.05v1.53h3.05v-3.05h-6.1zm0-16.76h4.57v1.52h-4.57Zm-1.52 12.19h1.52v1.52h-1.52Zm0-3.05h1.52v1.53h-1.52Zm-1.53-7.62h3.05v1.53h-3.05Zm0 9.15h1.53v1.52h-1.53Zm-1.52 1.52h1.52v1.52H9.14Zm0-3.05h1.52v1.53H9.14Zm0-6.09h1.52v1.52H9.14Zm-1.52 1.52h1.52v3.05H7.62Zm-4.57 3.05h4.57v1.52H3.05Zm-1.53 10.67h1.53v1.52H1.52Zm0-9.15h1.53v1.53H1.52ZM0 16.005h1.52v7.62H0Z"
      />
    </svg>
  );
};

export const MultiDeviceIcon = ({ size = 36, color = '#f59e0b' }: { size?: number; color?: string }) => {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 512 512" fill={color}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M42.667 64h384v160H384V106.667h-42.667v144h-42.666v-144H256V448H42.667zm42.666 42.667v298.666h128V106.667zm394.667 128h-32v10.666h-42.667V272h-128v160h64v26.667H384v10.666h32v-42.666h-32v10.666h-21.333v-42.666H384v10.666h32v-42.666h-32v10.666h-42.667V400h-32v-96h96v26.667H448v10.666h32v-42.666h-32v10.666h-21.333v-42.666H448v10.666h32zM192 128h-85.333v106.667H192zm-85.333 192H128v21.333h-21.333zM192 320h-21.333v21.333H192zm-53.333-42.667H160v21.334h-21.333zM160 362.667h-21.333V384H160z"
      />
    </svg>
  );
};

// Client Session ID for Multi-device conflict detection
const SESSION_KEY = 'shinzi_client_session_id';

export function getClientSessionId(): string {
  if (typeof window === 'undefined') return 'server_session';
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

// ---------------------------------------------------------------------
// 1. INTERNET CONNECTION TIMEOUT ERROR (Error code: 254)
// ---------------------------------------------------------------------
export interface InternetErrorProps {
  onRetry?: () => void;
}

export const InternetErrorScreen: React.FC<InternetErrorProps> = ({ onRetry }) => {
  const [checking, setChecking] = useState(false);

  const handleTryAgain = async () => {
    setChecking(true);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        // Still offline
        setTimeout(() => setChecking(false), 500);
        return;
      }
      // Quick test ping to verify internet connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch('/api/health', {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (resp && (resp.ok || resp.status < 500)) {
        if (onRetry) {
          onRetry();
        } else {
          window.location.reload();
        }
      } else {
        // Still no connectivity
        setChecking(false);
      }
    } catch {
      setChecking(false);
    }
  };

  return (
    <div style={errorContainerStyle}>
      {/* Icon badge */}
      <div style={iconBadgeStyle}>
        <Icon
          icon="streamline-pixel:internet-network-cloud-error"
          width={36}
          height={36}
          color="#f59e0b"
          fallback={<InternetErrorIcon size={36} color="#f59e0b" />}
        />
      </div>

      {/* Title */}
      <h2 style={titleTextStyle}>Internet connection timeout</h2>

      {/* Description */}
      <p style={descriptionTextStyle}>
        Please check your internet or wifi and try again.
      </p>

      {/* Error code */}
      <div style={errorCodeStyle}>Error code: 254</div>

      {/* Actions */}
      <div style={actionsContainerStyle}>
        <button
          type="button"
          onClick={handleTryAgain}
          disabled={checking}
          style={primaryButtonStyle}
        >
          {checking ? 'Checking…' : 'Try Again'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// 2. SAME ACCOUNT IN DIFFERENT DEVICES ERROR (Error code: 589)
// ---------------------------------------------------------------------
export interface MultiDeviceErrorProps {
  currentUid: string;
  onSessionReclaimed?: () => void;
}

export const MultiDeviceErrorScreen: React.FC<MultiDeviceErrorProps> = ({
  currentUid,
  onSessionReclaimed,
}) => {
  const [reclaiming, setReclaiming] = useState(false);

  const handleTryAgain = async () => {
    setReclaiming(true);
    try {
      const mySid = getClientSessionId();
      // Reclaim the active session in Firestore
      if (currentUid) {
        await updateDoc(doc(db, 'users', currentUid), {
          activeSessionId: mySid,
          lastSessionClaimedAt: serverTimestamp(),
        });
      }
      if (onSessionReclaimed) {
        onSessionReclaimed();
      } else {
        window.location.reload();
      }
    } catch (e) {
      console.error('[MultiDeviceError] Reclaim error:', e);
      window.location.reload();
    }
  };

  const handleLogout = async () => {
    try {
      try {
        const ShinziNotification = (window as any).Capacitor?.Plugins?.ShinziNotification;
        if (ShinziNotification?.clearAuthBackup) {
          await ShinziNotification.clearAuthBackup();
        }
      } catch {}
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('shinzi_auth_user');
      await signOut(auth);
      window.location.href = '/';
    } catch (e) {
      console.error('[MultiDeviceError] Logout error:', e);
      window.location.href = '/';
    }
  };

  return (
    <div style={errorContainerStyle}>
      {/* Icon badge */}
      <div style={iconBadgeStyle}>
        <Icon
          icon="ix:plc-device-user-data-type"
          width={36}
          height={36}
          color="#f59e0b"
          fallback={<MultiDeviceIcon size={36} color="#f59e0b" />}
        />
      </div>

      {/* Title */}
      <h2 style={titleTextStyle}>Same account in different devices</h2>

      {/* Description */}
      <p style={descriptionTextStyle}>
        Any other user has logged your account, please try again or log out.
      </p>

      {/* Error code */}
      <div style={errorCodeStyle}>Error code: 589</div>

      {/* Two Buttons: Try Again and Log Out */}
      <div style={actionsContainerStyle}>
        <button
          type="button"
          onClick={handleTryAgain}
          disabled={reclaiming}
          style={primaryButtonStyle}
        >
          {reclaiming ? 'Reclaiming…' : 'Try Again'}
        </button>

        <button
          type="button"
          onClick={handleLogout}
          style={secondaryButtonStyle}
        >
          Log Out
        </button>
      </div>
    </div>
  );
};

export const triggerNetworkTimeout = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shinzi:networkTimeout'));
  }
};

// ---------------------------------------------------------------------
// 3. GLOBAL APP ERROR MANAGER (Multi-device detection + Offline watcher)
// ---------------------------------------------------------------------
export const AppErrorManager: React.FC<{ currentUid: string | null; children?: React.ReactNode }> = ({
  currentUid,
  children,
}) => {
  const [isOffline, setIsOffline] = useState(() => {
    return typeof navigator !== 'undefined' ? !navigator.onLine : false;
  });
  const [hasMultiDeviceConflict, setHasMultiDeviceConflict] = useState(false);

  // Network offline/online listeners
  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleTimeout = () => setIsOffline(true);
    const handleOnline = () => {
      // Re-verify actual connectivity with quick ping
      fetch('/api/health', { method: 'HEAD', cache: 'no-store' })
        .then((r) => {
          if (r.ok || r.status < 500) setIsOffline(false);
        })
        .catch(() => setIsOffline(true));
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    window.addEventListener('shinzi:networkTimeout', handleTimeout);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('shinzi:networkTimeout', handleTimeout);
    };
  }, []);

  // Real-time Multi-device session conflict detection
  useEffect(() => {
    if (!currentUid) {
      setHasMultiDeviceConflict(false);
      return;
    }

    const mySid = getClientSessionId();
    const userDocRef = doc(db, 'users', currentUid);

    // Initial claim: stamp this device session if empty
    void updateDoc(userDocRef, {
      activeSessionId: mySid,
      lastSessionClaimedAt: serverTimestamp(),
    }).catch(() => {});

    // Listen for conflict in real-time
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (!docSnap.exists()) return;
        const data = docSnap.data();
        const serverSid = data?.activeSessionId;

        // If another device claimed the session, trigger Error 589!
        if (serverSid && serverSid !== mySid) {
          setHasMultiDeviceConflict(true);
        } else {
          setHasMultiDeviceConflict(false);
        }
      },
      (err) => {
        console.warn('[AppErrorManager] Session listener warning:', err);
      }
    );

    return () => unsubscribe();
  }, [currentUid]);

  // Priority 1: Internet Connection Timeout (Error 254)
  if (isOffline) {
    return (
      <InternetErrorScreen
        onRetry={() => {
          setIsOffline(false);
        }}
      />
    );
  }

  // Priority 2: Same Account in Different Devices (Error 589)
  if (hasMultiDeviceConflict && currentUid) {
    return (
      <MultiDeviceErrorScreen
        currentUid={currentUid}
        onSessionReclaimed={() => {
          setHasMultiDeviceConflict(false);
        }}
      />
    );
  }

  return <>{children}</>;
};

// ---------------------------------------------------------------------
// EXACT STYLES MATCHING IMG-20261117-WA0020
// ---------------------------------------------------------------------
const errorContainerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: '#000000',
  color: '#ffffff',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 20px',
  zIndex: 999999,
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  textAlign: 'center',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

const iconBadgeStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: '50%',
  backgroundColor: '#1e1e1e',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 20,
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
};

const titleTextStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 22,
  fontWeight: 700,
  color: '#ffffff',
  letterSpacing: '-0.3px',
};

const descriptionTextStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 14,
  color: '#a3a3a3',
  maxWidth: 320,
  lineHeight: 1.5,
};

const errorCodeStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#737373',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  marginBottom: 28,
  letterSpacing: '0.4px',
};

const actionsContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  justifyContent: 'center',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const primaryButtonStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#000000',
  border: 'none',
  borderRadius: 999,
  padding: '12px 28px',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  transition: 'transform 0.15s ease, opacity 0.15s ease',
  outline: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  backgroundColor: '#1f1f1f',
  color: '#ffffff',
  border: '1px solid #333333',
  borderRadius: 999,
  padding: '12px 26px',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  transition: 'transform 0.15s ease, opacity 0.15s ease',
  outline: 'none',
};
