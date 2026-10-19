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

type DriveFolderType =
  | 'profiles'
  | 'banners'
  | 'photos'
  | 'videos'
  | 'files'
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

  deleteFile: (
    fileId: string
  ) => Promise<boolean>;
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
  others: 'Others',
};

const DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.file';


// ============================================================
// GOOGLE WEB CLIENT ID
// ============================================================

const googleClientId =
  '1063333455169-ht2ld80klgvb89tgmj276mll1uacev8e.apps.googleusercontent.com';


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

const uploadMultipart = async (
  token: string,
  options: {
    folderId: string;
    fileName: string;
    mimeType: string;
    blob: Blob;
  }
): Promise<UploadedDriveFile> => {
  const { folderId, fileName, mimeType, blob } =
    options;

  const boundary =
    `shinzi_${Date.now().toString(36)}` +
    `_${Math.random().toString(36).slice(2)}`;

  const metadata = {
    name: fileName,
    mimeType,
    parents: [folderId],
  };

  const body = new Blob([
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n`,

    `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,

    blob,

    `\r\n--${boundary}--`,
  ]);

  const response = await fetch(
    `${DRIVE_UPLOAD_API}/files` +
      '?uploadType=multipart' +
      '&fields=id,name,mimeType,size,parents',
    {
      method: 'POST',

      headers: {
        ...getAuthHeader(token),

        'Content-Type':
          `multipart/related; boundary=${boundary}`,
      },

      body,
    }
  );

  await throwDriveError(
    response,
    'Unable to upload file to Google Drive.'
  );

  const uploaded = await response.json();

  if (!uploaded?.id) {
    throw new Error(
      'Google Drive upload completed without returning a file ID.'
    );
  }

  return {
    fileId: uploaded.id,

    folderId,

    fileName: uploaded.name || fileName,

    mimeType: uploaded.mimeType || mimeType,

    sizeBytes: uploaded.size
      ? Number(uploaded.size)
      : blob.size,
  };
};



export const useDriveStore = (): DriveStore => {
  const tokenRef = useRef<string | null>(null);
  const expiresAtRef = useRef(0);

  const [hasActiveSession, setHasActiveSession] =
    useState(false);

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
      tokenRef.current = token;
      expiresAtRef.current =
        Date.now() + Math.max(60, expiresIn) * 1000;
      setHasActiveSession(true);
    },
    [],
  );

  const clearAuth = useCallback(async (): Promise<void> => {
    tokenRef.current = null;
    expiresAtRef.current = 0;
    setHasActiveSession(false);
  }, []);

  const hasValidToken = useCallback((): boolean => {
    return Boolean(
      tokenRef.current &&
      Date.now() <
        expiresAtRef.current - TOKEN_EXPIRY_MARGIN_MS,
    );
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

          // Read the bytes first so a bad file fails
          // before any Drive folders are created.
          let blob: Blob;

          if (file) {
            blob = file;
          } else {
            const localResponse =
              await fetch(localUri as string);

            if (!localResponse.ok) {
              throw new Error(
                'Unable to read the selected local file.'
              );
            }

            blob = await localResponse.blob();
          }

          return withToken(async (token) => {
            const folder =
              await getShinziSubfolder(
                token,
                folderType
              );

            return uploadMultipart(token, {
              folderId: folder.id,
              fileName,
              mimeType,
              blob,
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

          const textBlob = new Blob([text], {
            type: 'text/plain; charset=utf-8',
          });

          return withToken(async (token) => {
            const folder =
              await getShinziSubfolder(
                token,
                folderType
              );

            return uploadMultipart(token, {
              folderId: folder.id,
              fileName,
              mimeType:
                'text/plain; charset=utf-8',
              blob: textBlob,
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

         return withToken(async (token) => {
  const controller = new AbortController();

  const timeoutId = window.setTimeout(
    () => controller.abort(),
    15000
  );

  let response: Response;

  try {
    response = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(
        fileId
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

            if (!blob) {
              throw new Error(
                'Google Drive returned empty file data.'
              );
            }

            return blobToDataUri(blob);
          });
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
              return true;
            }

            await throwDriveError(
              response,
              'Unable to delete Google Drive file.'
            );

            return true;
          });
        },
        [withToken]
      );


    // ========================================================
    // RETURN STORE API
    // ========================================================

    return {
      isReady: isGoogleReady,

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

      deleteFile,
    };
  };
