const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    title: 'Shinzi',
    icon: path.join(__dirname, '../public/icon-512.png'),
    backgroundColor: '#08080a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      webSecurity: true,
    },
  });

  // Smooth window show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links (http/https not from our app) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith('http:') ||
      url.startsWith('https:')
    ) {
      if (!url.includes('shinzi.vercel.app') && !url.includes('accounts.spotify.com') && !url.includes('accounts.google.com')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  // Always load live web app to guarantee 100% synchronization, fallback to dist/index.html
  const liveUrl = 'https://shinzi.vercel.app';
  mainWindow.loadURL(liveUrl).catch(() => {
    console.log('Falling back to local build...');
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
