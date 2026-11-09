import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebaseConfig';

// ============================================================
// TYPES
// ============================================================

export type DriveFolderType =
  | 'profiles'
  | 'banners'
  | 'photos'
  | 'videos'
  | 'files'
  | 'voice'
  | 'server'
  | 'others';

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: {
    prompt?: string;
  }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: unknown) => void;
  }) => GoogleTokenClient;
}

interface GoogleAccounts {
  oauth2: GoogleAccountsOAuth2;
}

interface GoogleIdentityServices {
  accounts: GoogleAccounts;
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
}

interface UploadFileOptions {
  // Preferred: pass the File/Blob directly. It does not
  // depend on an object URL staying alive.
  file?: Blob;

  // Fallback: an object URL / URL that fetch() can read.
  localUri?: string;

  fileName: string;
  mimeType: string;
  folderType?: DriveFolderType;
}

interface CreateTextFileOptions {
  text: string;
  fileName: string;
  folderType?: DriveFolderType;
}

interface UploadedDriveFile {
  fileId: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface DriveStore {
  isReady: boolean;
  hasActiveSession: boolean;
  isConnecting: boolean;

  connectDrive: (switchAccount?: boolean) => Promise<string | null>;

  clearAuth: () => Promise<void>;

  getValidAccessToken: () => Promise<string | null>;

  getOrCreateFolder: (
    token: string,
    name: string,
    parentId?: string | null
  ) => Promise<DriveFile>;

  getShinziFolder: (
    token: string
  ) => Promise<DriveFile>;

  getShinziSubfolder: (
    token: string,
    folderType: DriveFolderType
  ) => Promise<DriveFile>;

  uploadFile: (
    options: UploadFileOptions
  ) => Promise<UploadedDriveFile>;

  createTextFile: (
    options: CreateTextFileOptions
  ) => Promise<UploadedDriveFile>;

  getFileMetadata: (
    fileId: string
  ) => Promise<DriveFile>;

  getFileDataUri: (
    fileId: string
  ) => Promise<string>;

  makeFilePublic: (
    fileId: string
  ) => Promise<boolean>;

  deleteFile: (
    fileId: string
  ) => Promise<boolean>;

  cleanOldFiles: (
    folderType: DriveFolderType,
    keepFileId?: string
  ) => Promise<number>;
}


// ============================================================
// CONSTANTS
// ============================================================



// Treat a token as expired a little early so it does not
// die halfway through an upload.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

const DRIVE_API =
  'https://www.googleapis.com/drive/v3';

const DRIVE_UPLOAD_API =
  'https://www.googleapis.com/upload/drive/v3';

const SHINZI_FOLDER_NAME = 'Shinzi';

const SHINZI_SUBFOLDERS: Record<
  DriveFolderType,
  string
> = {
  profiles: 'Profiles',
  banners: 'Banners',
  photos: 'Photos',
  videos: 'Videos',
  files: 'Files',
  voice: 'Voice',
  server: 'server',
  others: 'Others',
};



// ============================================================
// HELPERS
// ============================================================

class DriveError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

const getAuthHeader = (
  token: string
): HeadersInit => ({
  Authorization: `Bearer ${token}`,
});

const throwDriveError = async (
  response: Response,
  fallbackMessage: string
): Promise<void> => {
  if (response.ok) {
    return;
  }

  let message = fallbackMessage;

  try {
    const data = await response.json();

    if (data?.error?.message) {
      message = data.error.message;
    }
  } catch {
    // Ignore JSON parsing failure.
  }

  throw new DriveError(
    response.status,
    `Google Drive error (${response.status}): ${message}`
  );
};

const blobToDataUri = (
  blob: Blob
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(
          new Error(
            'Unable to convert Drive file into image data.'
          )
        );
      }
    };

    reader.onerror = () => {
      reject(
        new Error(
          'Failed to read downloaded Drive file.'
        )
      );
    };

    reader.readAsDataURL(blob);
  });

// ============================================================
// IMAGE CACHING & REQUEST DEDUPLICATION
// ============================================================
const driveDataUriCache = new Map<string, string>();
const inFlightDriveRequests = new Map<string, Promise<string>>();

let sharedDriveToken: string | null = null;
let sharedDriveExpiresAt = 0;

function getStoredDriveToken(): { token: string; expiresAt: number } | null {
  if (
    sharedDriveToken &&
    Date.now() < sharedDriveExpiresAt - TOKEN_EXPIRY_MARGIN_MS
  ) {
    return { token: sharedDriveToken, expiresAt: sharedDriveExpiresAt };
  }

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const stored = window.sessionStorage.getItem('shinzi_drive_token_data');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          parsed?.token &&
          typeof parsed.expiresAt === 'number' &&
          Date.now() < parsed.expiresAt - TOKEN_EXPIRY_MARGIN_MS
        ) {
          sharedDriveToken = parsed.token;
          sharedDriveExpiresAt = parsed.expiresAt;
          return { token: parsed.token, expiresAt: parsed.expiresAt };
        }
      }
    } catch {}
  }

  return null;
}

function storeDriveToken(token: string, expiresAt: number) {
  sharedDriveToken = token;
  sharedDriveExpiresAt = expiresAt;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(
        'shinzi_drive_token_data',
        JSON.stringify({ token, expiresAt }),
      );
    } catch {}
  }
}

function clearStoredDriveToken() {
  sharedDriveToken = null;
  sharedDriveExpiresAt = 0;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem('shinzi_drive_token_data');
    } catch {}
  }
}

// ------------------------------------------------------------
// ONE-REQUEST UPLOAD
// ------------------------------------------------------------
//
// Uploads the file AND places it in the target folder in a
// single multipart request (metadata + media).
//
// The old flow uploaded the bytes first and then PATCHed the
// file with addParents. That could leave an "Untitled" file
// in the root of the user's Drive if the second step failed,
// and the rollback never knew about it. One request means
// either the file exists in the right folder or it does not.
//
// ------------------------------------------------------------

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MiB chunks (multiple of 256 KiB)

const uploadResumableDrive = async (
  token: string,
  options: {
    folderId: string;
    fileName: string;
    mimeType: string;
    buffer: ArrayBuffer;
  }
): Promise<UploadedDriveFile> => {
  const { folderId, fileName, mimeType, buffer } = options;
  const totalBytes = buffer.byteLength;

  // 1. Session initiation
  const initRes = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable`,
    {
      method: 'POST',
      headers: {
        ...getAuthHeader(token),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(totalBytes),
      },
      body: JSON.stringify({
        name: fileName,
        mimeType,
        parents: [folderId],
      }),
    }
  );

  await throwDriveError(
    initRes,
    '[Drive Session] Unable to start Google Drive resumable upload session.'
  );

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) {
    throw new Error(
      '[Drive Session] Google Drive did not return a resumable upload URL.'
    );
  }

  // 2. Upload in 2MB pieces with resume-on-failure
  let offset = 0;
  let finalUploaded: any = null;

  while (offset < totalBytes) {
    const chunkEnd = Math.min(offset + CHUNK_SIZE, totalBytes);
    const chunkData = buffer.slice(offset, chunkEnd);
    const contentRange = `bytes ${offset}-${chunkEnd - 1}/${totalBytes}`;

    let chunkAccepted = false;
    let retries = 0;

    while (!chunkAccepted && retries < 4) {
      retries++;
      try {
        const chunkRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': contentRange,
          },
          body: chunkData,
        });

        if (chunkRes.status === 308) {
          const rangeHeader = chunkRes.headers.get('Range');
          if (rangeHeader) {
            const match = rangeHeader.match(/bytes=0-(\d+)/);
            if (match) {
              offset = parseInt(match[1], 10) + 1;
            } else {
              offset = chunkEnd;
            }
          } else {
            offset = chunkEnd;
          }
          chunkAccepted = true;
        } else if (chunkRes.ok) {
          finalUploaded = await chunkRes.json();
          offset = totalBytes;
          chunkAccepted = true;
        } else {
          throw new Error(`Drive upload chunk status: ${chunkRes.status}`);
        }
      } catch (chunkErr) {
        console.warn(`[Drive Upload] Chunk attempt ${retries} failed for ${contentRange}:`, chunkErr);
        if (retries >= 4) {
          throw new Error(
            `[Drive Upload] Network connection failed while uploading to Google Drive (${chunkErr instanceof Error ? chunkErr.message : 'aborted'}).`
          );
        }

        await new Promise((r) => setTimeout(r, 1000 * retries));

        // Query status from Drive to see what bytes were received
        try {
          const statusRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Range': `bytes */${totalBytes}`,
            },
          });

          if (statusRes.status === 308) {
            const rangeHeader = statusRes.headers.get('Range');
            if (rangeHeader) {
              const match = rangeHeader.match(/bytes=0-(\d+)/);
              if (match) {
                offset = parseInt(match[1], 10) + 1;
                chunkAccepted = true;
                break;
              }
            }
          } else if (statusRes.ok) {
            finalUploaded = await statusRes.json();
            offset = totalBytes;
            chunkAccepted = true;
            break;
          }
        } catch (statusErr) {
          console.warn('[Drive Upload] Status check failed:', statusErr);
        }
      }
    }
  }

  if (!finalUploaded?.id) {
    throw new Error('[Drive Upload] Google Drive upload completed without returning a file ID.');
  }

  // Grant public read permission
  try {
    await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(finalUploaded.id)}/permissions`,
      {
        method: 'POST',
        headers: {
          ...getAuthHeader(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
      }
    );
  } catch {}

  return {
    fileId: finalUploaded.id,
    folderId,
    fileName: finalUploaded.name || fileName,
    mimeType: finalUploaded.mimeType || mimeType,
    sizeBytes: finalUploaded.size ? Number(finalUploaded.size) : totalBytes,
  };
};



export const useDriveStore = (): DriveStore => {
  const initialTokenData = getStoredDriveToken();
  const tokenRef = useRef<string | null>(initialTokenData?.token ?? null);
  const expiresAtRef = useRef<number>(initialTokenData?.expiresAt ?? 0);

  const [hasActiveSession, setHasActiveSession] =
    useState<boolean>(Boolean(initialTokenData));

  const [isConnecting, setIsConnecting] =
    useState(false);

  const [firebaseUserReady, setFirebaseUserReady] =
    useState(false);

  const refreshPromiseRef =
    useRef<Promise<string | null> | null>(null);

  const connectPromiseRef =
    useRef<Promise<string | null> | null>(null);

  const applyToken = useCallback(
    (token: string, expiresIn: number) => {
      const expiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
      tokenRef.current = token;
      expiresAtRef.current = expiresAt;
      storeDriveToken(token, expiresAt);
      setHasActiveSession(true);
    },
    [],
  );

  const clearAuth = useCallback(async (): Promise<void> => {
    tokenRef.current = null;
    expiresAtRef.current = 0;
    clearStoredDriveToken();
    setHasActiveSession(false);
  }, []);

  const hasValidToken = useCallback((): boolean => {
    if (
      tokenRef.current &&
      Date.now() <
        expiresAtRef.current - TOKEN_EXPIRY_MARGIN_MS
    ) {
      return true;
    }

    const stored = getStoredDriveToken();
    if (stored) {
      tokenRef.current = stored.token;
      expiresAtRef.current = stored.expiresAt;
      setHasActiveSession(true);
      return true;
    }

    return false;
  }, []);

  const refreshAccessToken = useCallback(
    async (): Promise<string | null> => {
      if (hasValidToken()) {
        return tokenRef.current;
      }

      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }

      const user = auth.currentUser;

      if (!user) {
        await clearAuth();
        return null;
      }

      const refreshPromise = (async () => {
        const firebaseIdToken = await user.getIdToken();

        const response = await fetch('/api/drive/refresh', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${firebaseIdToken}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          cache: 'no-store',
        });

        if (response.status === 404) {
          await clearAuth();
          return null;
        }

        if (!response.ok) {
          await clearAuth();

          if (response.status === 401) {
            return null;
          }

          throw new Error(
            `Drive refresh failed (${response.status}). Please retry.`,
          );
        }

        const data: {
          accessToken?: string;
          expiresIn?: number;
        } = await response.json();

        if (
          typeof data.accessToken !== 'string' ||
          !data.accessToken
        ) {
          throw new Error(
            'The Drive refresh endpoint returned no access token.',
          );
        }

        applyToken(
          data.accessToken,
          Number(data.expiresIn) || 3600,
        );

        return data.accessToken;
      })();

      refreshPromiseRef.current = refreshPromise;

      try {
        return await refreshPromise;
      } finally {
        if (refreshPromiseRef.current === refreshPromise) {
          refreshPromiseRef.current = null;
        }
      }
    },
    [applyToken, clearAuth, hasValidToken],
  );

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        setFirebaseUserReady(true);

        if (!user) {
          await clearAuth();
          return;
        }

        if (hasValidToken()) {
          return;
        }

        try {
          await refreshAccessToken();
        } catch (error) {
          if (!cancelled) {
            console.error(
              'Unable to restore the Drive session:',
              error,
            );
          }
        }
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [clearAuth, refreshAccessToken]);

  const connectDrive = useCallback(
    async (
      switchAccount = false,
    ): Promise<string | null> => {
      if (connectPromiseRef.current) {
        return connectPromiseRef.current;
      }

      const user = auth.currentUser;

      if (!user) {
        throw new Error(
          'Please sign in to Shinzi Hub before connecting Google Drive.',
        );
      }

      if (!switchAccount) {
        const existingToken = await refreshAccessToken();

        if (existingToken) {
          return existingToken;
        }
      }

      setIsConnecting(true);

      const connectPromise = (async () => {
        const firebaseIdToken = await user.getIdToken();

        const response = await fetch('/api/drive/start', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${firebaseIdToken}`,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
          cache: 'no-store',
          body: JSON.stringify({ switchAccount }),
        });

        if (!response.ok) {
          throw new Error(
            `Unable to start Google authorization (${response.status}).`,
          );
        }

        const data: { url?: string } =
          await response.json();

        if (
          typeof data.url !== 'string' ||
          !data.url.startsWith(
            'https://accounts.google.com/',
          )
        ) {
          throw new Error(
            'The server returned an invalid Google authorization URL.',
          );
        }

        // The OAuth callback returns to Shinzi Hub.
        window.location.assign(data.url);

        return null;
      })();

      connectPromiseRef.current = connectPromise;

      try {
        return await connectPromise;
      } finally {
        connectPromiseRef.current = null;
        setIsConnecting(false);
      }
    },
    [refreshAccessToken],
  );

  const getValidAccessToken = useCallback(
    async (): Promise<string | null> => {
      if (hasValidToken()) {
        return tokenRef.current;
      }

      // Background image loading must never unexpectedly
      // launch a Google authorization screen.
      return refreshAccessToken();
    },
    [hasValidToken, refreshAccessToken],
  );

  const withToken = useCallback(
    async <T>(
      run: (token: string) => Promise<T>,
    ): Promise<T> => {
      const token = await getValidAccessToken();

      if (!token) {
        throw new Error(
          'Google Drive is not connected. Use the Connect Drive button to authorize it.',
        );
      }

      try {
        return await run(token);
      } catch (error) {
        if (
          error instanceof DriveError &&
          error.status === 401
        ) {
          await clearAuth();

          throw new Error(
            'Your Google Drive authorization expired. Please reconnect Drive and retry.',
          );
        }

        throw error;
      }
    },
    [getValidAccessToken, clearAuth],
  );


// ========================================================
    // FIND FOLDER
    // ========================================================

    const findFolder =
      useCallback(
        async (
          token: string,
          name: string,
          parentId: string | null = null
        ): Promise<DriveFile | null> => {

          let query =
            `name = '${name.replace(
              /'/g,
              "\\'"
            )}'` +
            ` and mimeType = 'application/vnd.google-apps.folder'` +
            ` and trashed = false`;

          if (parentId) {
            query +=
              ` and '${parentId}' in parents`;
          }

          const url =
            `${DRIVE_API}/files` +
            `?q=${encodeURIComponent(query)}` +
            `&spaces=drive` +
            `&pageSize=1` +
            `&fields=files(id,name,mimeType,parents)`;

          const response = await fetch(url, {
            headers: getAuthHeader(token),
          });

          await throwDriveError(
            response,
            'Unable to search Google Drive folders.'
          );

          const data = await response.json();

          return data?.files?.[0] || null;
        },
        []
      );


    // ========================================================
    // CREATE FOLDER
    // ========================================================

    const createFolder =
      useCallback(
        async (
          token: string,
          name: string,
          parentId: string | null = null
        ): Promise<DriveFile> => {

          const body: {
            name: string;
            mimeType: string;
            parents?: string[];
          } = {
            name,

            mimeType:
              'application/vnd.google-apps.folder',
          };

          if (parentId) {
            body.parents = [parentId];
          }

          const response = await fetch(
            `${DRIVE_API}/files?fields=id,name,mimeType,parents`,
            {
              method: 'POST',

              headers: {
                ...getAuthHeader(token),

                'Content-Type':
                  'application/json',
              },

              body: JSON.stringify(body),
            }
          );

          await throwDriveError(
            response,
            `Unable to create Drive folder "${name}".`
          );

          return response.json();
        },
        []
      );


    // ========================================================
    // GET OR CREATE FOLDER
    // ========================================================

    const getOrCreateFolder =
      useCallback(
        async (
          token: string,
          name: string,
          parentId: string | null = null
        ): Promise<DriveFile> => {

          const existing = await findFolder(
            token,
            name,
            parentId
          );

          if (existing) {
            return existing;
          }

          return createFolder(
            token,
            name,
            parentId
          );
        },
        [findFolder, createFolder]
      );


    // ========================================================
    // GET SHINZI ROOT FOLDER
    // ========================================================

    const getShinziFolder =
      useCallback(
        async (
          token: string
        ): Promise<DriveFile> => {
          return getOrCreateFolder(
            token,
            SHINZI_FOLDER_NAME
          );
        },
        [getOrCreateFolder]
      );


    // ========================================================
    // GET SHINZI SUBFOLDER
    // ========================================================

    const getShinziSubfolder =
      useCallback(
        async (
          token: string,
          folderType: DriveFolderType
        ): Promise<DriveFile> => {

          const folderName =
            SHINZI_SUBFOLDERS[folderType];

          if (!folderName) {
            throw new Error(
              `Unknown Shinzi folder type: ${folderType}`
            );
          }

          const root =
            await getShinziFolder(token);

          return getOrCreateFolder(
            token,
            folderName,
            root.id
          );
        },
        [getShinziFolder, getOrCreateFolder]
      );


    // ========================================================
    // UPLOAD FILE
    // ========================================================

    const uploadFile =
      useCallback(
        async ({
          file,
          localUri,
          fileName,
          mimeType,
          folderType = 'others',
        }: UploadFileOptions): Promise<UploadedDriveFile> => {

          if (!file && !localUri) {
            throw new Error(
              'A file or local file URI is required.'
            );
          }

          if (!fileName) {
            throw new Error(
              'A file name is required.'
            );
          }

          if (!mimeType) {
            throw new Error(
              'A MIME type is required.'
            );
          }

          // Read the bytes into memory first so a bad file fails
          // before any Drive folders are created, and prevents detached
          // native file handles on mobile Chrome.
          let buffer: ArrayBuffer;

          if (file) {
            try {
              buffer = await file.arrayBuffer();
            } catch (readErr) {
              throw new Error(
                `[File Read] Unable to read selected file into memory: ${readErr instanceof Error ? readErr.message : 'aborted'}`
              );
            }
          } else {
            const localResponse =
              await fetch(localUri as string);

            if (!localResponse.ok) {
              throw new Error(
                '[File Read] Unable to read the selected local file.'
              );
            }

            buffer = await localResponse.arrayBuffer();
          }

          return withToken(async (token) => {
            const folder =
              await getShinziSubfolder(
                token,
                folderType
              );

            return uploadResumableDrive(token, {
              folderId: folder.id,
              fileName,
              mimeType,
              buffer,
            });
          });
        },
        [withToken, getShinziSubfolder]
      );


    // ========================================================
    // CREATE TEXT FILE
    // ========================================================

    const createTextFile =
      useCallback(
        async ({
          text,
          fileName,
          folderType = 'others',
        }: CreateTextFileOptions): Promise<UploadedDriveFile> => {

          if (typeof text !== 'string') {
            throw new Error(
              'Text content must be a string.'
            );
          }

          if (!fileName) {
            throw new Error(
              'A file name is required.'
            );
          }

          const textBuffer = new TextEncoder().encode(text).buffer;

          return withToken(async (token) => {
            const folder =
              await getShinziSubfolder(
                token,
                folderType
              );

            return uploadResumableDrive(token, {
              folderId: folder.id,
              fileName,
              mimeType:
                'text/plain; charset=utf-8',
              buffer: textBuffer,
            });
          });
        },
        [withToken, getShinziSubfolder]
      );


    // ========================================================
    // GET FILE METADATA
    // ========================================================

    const getFileMetadata =
      useCallback(
        async (
          fileId: string
        ): Promise<DriveFile> => {

          if (!fileId) {
            throw new Error(
              'A Google Drive file ID is required.'
            );
          }

          return withToken(async (token) => {
            const response = await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                fileId
              )}` +
                `?fields=id,name,mimeType,size,parents,trashed`,
              {
                headers: getAuthHeader(token),
              }
            );

            await throwDriveError(
              response,
              'Unable to retrieve Google Drive file metadata.'
            );

            return response.json();
          });
        },
        [withToken]
      );


    // ========================================================
    // GET FILE DATA URI
    // ========================================================

    const getFileDataUri =
      useCallback(
        async (
          fileId: string
        ): Promise<string> => {

          if (!fileId) {
            throw new Error(
              'A Google Drive file ID is required.'
            );
          }

          const trimmedId = fileId.trim();

          // 1. Check in-memory cache
          const inMemory = driveDataUriCache.get(trimmedId);
          if (inMemory) {
            return inMemory;
          }

          // 2. Check browser session storage cache
          if (typeof window !== 'undefined' && window.sessionStorage) {
            try {
              const sessionItem = window.sessionStorage.getItem(`shinzi_drive_${trimmedId}`);
              if (sessionItem) {
                driveDataUriCache.set(trimmedId, sessionItem);
                return sessionItem;
              }
            } catch {
              // Ignore session storage errors
            }
          }

          // 3. Request deduplication (reuse active in-flight download)
          const inFlight = inFlightDriveRequests.get(trimmedId);
          if (inFlight) {
            return inFlight;
          }

          const fetchPromise = (async () => {
            try {
              // 1. Try authenticated Drive download if user has connected Google Drive
              if (hasValidToken()) {
                try {
                  return await withToken(async (token) => {
                    const controller = new AbortController();
                    const timeoutId = window.setTimeout(
                      () => controller.abort(),
                      15000
                    );

                    let response: Response;
                    try {
                      response = await fetch(
                        `${DRIVE_API}/files/${encodeURIComponent(
                          trimmedId
                        )}?alt=media`,
                        {
                          headers: getAuthHeader(token),
                          signal: controller.signal,
                        }
                      );
                    } catch (error) {
                      if (
                        error instanceof Error &&
                        error.name === 'AbortError'
                      ) {
                        throw new Error(
                          'Google Drive took too long to load this image. Please retry.'
                        );
                      }
                      throw new Error(
                        'Unable to reach Google Drive. Check your connection and retry.'
                      );
                    } finally {
                      window.clearTimeout(timeoutId);
                    }

                    await throwDriveError(
                      response,
                      'Unable to download Google Drive file.'
                    );

                    const blob = await response.blob();
                    if (!blob || blob.size === 0) {
                      throw new Error('Google Drive returned empty file data.');
                    }

                    const dataUri = await blobToDataUri(blob);
                    driveDataUriCache.set(trimmedId, dataUri);

                    if (typeof window !== 'undefined' && window.sessionStorage) {
                      try {
                        window.sessionStorage.setItem(`shinzi_drive_${trimmedId}`, dataUri);
                      } catch {}
                    }

                    return dataUri;
                  });
                } catch (tokenErr) {
                  console.info('[DRIVE] Authenticated download unavailable, falling back to public CDN:', tokenErr);
                }
              }

              // 2. Fallback: Public Google Drive image CDN and thumbnail endpoints
              // Enables profile photos and banners to load on any phone / user without OAuth
              const publicEndpoints = [
                `https://lh3.googleusercontent.com/d/${encodeURIComponent(trimmedId)}=s800`,
                `https://drive.google.com/thumbnail?id=${encodeURIComponent(trimmedId)}&sz=w800`,
                `https://drive.google.com/uc?export=view&id=${encodeURIComponent(trimmedId)}`,
              ];

              for (const endpoint of publicEndpoints) {
                try {
                  const controller = new AbortController();
                  const timeoutId = window.setTimeout(() => controller.abort(), 8000);
                  const response = await fetch(endpoint, { signal: controller.signal });
                  window.clearTimeout(timeoutId);

                  if (response.ok) {
                    const blob = await response.blob();
                    if (blob && blob.size > 0 && blob.type.startsWith('image/')) {
                      const dataUri = await blobToDataUri(blob);
                      driveDataUriCache.set(trimmedId, dataUri);
                      if (typeof window !== 'undefined' && window.sessionStorage) {
                        try {
                          window.sessionStorage.setItem(`shinzi_drive_${trimmedId}`, dataUri);
                        } catch {}
                      }
                      return dataUri;
                    }
                  }
                } catch {}
              }

              // 3. Final fallback: return high-speed Google CDN URL for direct browser <img> loading
              const directCdnUrl = `https://lh3.googleusercontent.com/d/${encodeURIComponent(trimmedId)}=s800`;
              driveDataUriCache.set(trimmedId, directCdnUrl);
              return directCdnUrl;
            } finally {
              inFlightDriveRequests.delete(trimmedId);
            }
          })();

          inFlightDriveRequests.set(trimmedId, fetchPromise);
          return fetchPromise;
        },
        [withToken]
      );


    // ========================================================
    // DELETE FILE
    // ========================================================
    //
    // A 404 means the file is already gone, which is the
    // outcome a delete/rollback wants, so it counts as success.
    //
    // ========================================================

    const deleteFile =
      useCallback(
        async (
          fileId: string
        ): Promise<boolean> => {

          if (!fileId) {
            throw new Error(
              'A Google Drive file ID is required.'
            );
          }

          return withToken(async (token) => {
            const response = await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                fileId
              )}`,
              {
                method: 'DELETE',

                headers: getAuthHeader(token),
              }
            );

            if (response.status === 404) {
              driveDataUriCache.delete(fileId.trim());
              try {
                window.sessionStorage?.removeItem(`shinzi_drive_${fileId.trim()}`);
              } catch {}
              return true;
            }

            await throwDriveError(
              response,
              'Unable to delete Google Drive file.'
            );

            driveDataUriCache.delete(fileId.trim());
            try {
              window.sessionStorage?.removeItem(`shinzi_drive_${fileId.trim()}`);
            } catch {}

            return true;
          });
        },
        [withToken]
      );

    const makeFilePublic =
      useCallback(
        async (fileId: string): Promise<boolean> => {
          if (!fileId) return false;
          try {
            return await withToken(async (token) => {
              const res = await fetch(
                `${DRIVE_API}/files/${encodeURIComponent(fileId.trim())}/permissions`,
                {
                  method: 'POST',
                  headers: {
                    ...getAuthHeader(token),
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    role: 'reader',
                    type: 'anyone',
                  }),
                }
              );
              return res.ok;
            });
          } catch {
            return false;
          }
        },
        [withToken]
      );


    const cleanOldFiles = useCallback(
      async (folderType: DriveFolderType, keepFileId?: string): Promise<number> => {
        return withToken(async (token) => {
          let deletedCount = 0;
          try {
            const folder = await getShinziSubfolder(token, folderType);
            const query = encodeURIComponent(`'${folder.id}' in parents and trashed = false`);
            const res = await fetch(
              `${DRIVE_API}/files?q=${query}&fields=files(id,name)`,
              { headers: getAuthHeader(token) }
            );
            if (res.ok) {
              const data = await res.json();
              for (const f of data.files || []) {
                if (f.id && f.id !== keepFileId) {
                  await fetch(`${DRIVE_API}/files/${encodeURIComponent(f.id)}`, {
                    method: 'DELETE',
                    headers: getAuthHeader(token),
                  }).catch(() => {});
                  deletedCount++;
                }
              }
            }
          } catch (e) {
            console.warn('[driveStore] cleanOldFiles folder error:', e);
          }

          // Clean up any old ast_*.gif files accidentally created in root My Drive
          try {
            const rootQuery = encodeURIComponent(`'root' in parents and trashed = false`);
            const rootRes = await fetch(
              `${DRIVE_API}/files?q=${rootQuery}&fields=files(id,name)`,
              { headers: getAuthHeader(token) }
            );
            if (rootRes.ok) {
              const rootData = await rootRes.json();
              for (const f of rootData.files || []) {
                if (f.name && f.name.startsWith('ast_') && (f.name.endsWith('.gif') || f.name.endsWith('.mp4') || f.name.endsWith('.png') || f.name.endsWith('.webp') || f.name.endsWith('.jpg') || f.name.endsWith('.jpeg'))) {
                  if (f.id !== keepFileId) {
                    await fetch(`${DRIVE_API}/files/${encodeURIComponent(f.id)}`, {
                      method: 'DELETE',
                      headers: getAuthHeader(token),
                    }).catch(() => {});
                    deletedCount++;
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[driveStore] cleanOldFiles root error:', e);
          }

          return deletedCount;
        });
      },
      [withToken, getShinziSubfolder]
    );

    // ========================================================
    // RETURN STORE API
    // ========================================================

    return {
      isReady: firebaseUserReady,

      hasActiveSession,

      isConnecting,

      connectDrive,

      clearAuth,

      getValidAccessToken,

      getOrCreateFolder,

      getShinziFolder,

      getShinziSubfolder,

      uploadFile,

      createTextFile,

      getFileMetadata,

      getFileDataUri,

      makeFilePublic,

      deleteFile,

      cleanOldFiles,
    };
  };
