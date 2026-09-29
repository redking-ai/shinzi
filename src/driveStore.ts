import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

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

  connectDrive: () => Promise<string | null>;

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

const AUTH_STORAGE_KEY = 'drive_auth';

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


// ============================================================
// GOOGLE IDENTITY SERVICES SCRIPT
// ============================================================

let googleScriptPromise:
  Promise<void> | null = null;

const loadGoogleIdentityServices =
  (): Promise<void> => {
    if (typeof window === 'undefined') {
      return Promise.reject(
        new Error(
          'Google Drive authentication is only available in a browser.'
        )
      );
    }

    if (window.google?.accounts?.oauth2) {
      return Promise.resolve();
    }

    if (googleScriptPromise) {
      return googleScriptPromise;
    }

    googleScriptPromise = new Promise<void>(
      (resolve, reject) => {
        const existingScript =
          document.querySelector(
            'script[data-shinzi-google-gis="true"]'
          );

        if (existingScript) {
          existingScript.addEventListener(
            'load',
            () => resolve()
          );

          existingScript.addEventListener(
            'error',
            () =>
              reject(
                new Error(
                  'Unable to load Google authentication.'
                )
              )
          );

          return;
        }

        const script =
          document.createElement('script');

        script.src =
          'https://accounts.google.com/gsi/client';

        script.async = true;
        script.defer = true;

        script.dataset.shinziGoogleGis = 'true';

        script.onload = () => {
          if (window.google?.accounts?.oauth2) {
            resolve();
          } else {
            reject(
              new Error(
                'Google authentication loaded incorrectly.'
              )
            );
          }
        };

        script.onerror = () => {
          // Allow a later retry instead of caching failure.
          googleScriptPromise = null;

          reject(
            new Error(
              'Unable to load Google authentication.'
            )
          );
        };

        document.head.appendChild(script);
      }
    );

    return googleScriptPromise;
  };


// ============================================================
// GOOGLE DRIVE STORE
// ============================================================

export const useDriveStore =
  (): DriveStore => {

    // The access token lives in REFS, not only in state.
    // Async functions capture state at the moment they are
    // created; a token obtained a moment ago (during the
    // same click) would look like null to them and trigger
    // a second consent popup. Refs always hold the latest.
    const tokenRef =
      useRef<string | null>(null);

    const expiresAtRef = useRef(0);

    const [
      hasActiveSession,
      setHasActiveSession,
    ] = useState(false);

    const [
      isConnecting,
      setIsConnecting,
    ] = useState(false);

    const [
      isGoogleReady,
      setIsGoogleReady,
    ] = useState(false);

    const tokenClientRef =
      useRef<GoogleTokenClient | null>(null);

    const connectionResolverRef =
      useRef<
        ((token: string | null) => void) | null
      >(null);

    const connectPromiseRef =
      useRef<Promise<string | null> | null>(null);


    // ========================================================
    // TOKEN HELPERS
    // ========================================================

    const hasValidToken =
      useCallback((): boolean => {
        return (
          !!tokenRef.current &&
          Date.now() <
            expiresAtRef.current -
              TOKEN_EXPIRY_MARGIN_MS
        );
      }, []);

    const applyToken =
      useCallback(
        (
          token: string,
          expiresAt: number,
          persist: boolean
        ): void => {
          tokenRef.current = token;
          expiresAtRef.current = expiresAt;

          setHasActiveSession(true);

          if (persist) {
            try {
              sessionStorage.setItem(
                AUTH_STORAGE_KEY,
                JSON.stringify({
                  token,
                  expiresAt,
                })
              );
            } catch (storageError) {
              console.warn(
                'Failed to store Drive session:',
                storageError
              );
            }
          }
        },
        []
      );

    const clearAuth =
      useCallback(
        async (): Promise<void> => {
          tokenRef.current = null;
          expiresAtRef.current = 0;

          setHasActiveSession(false);

          try {
            sessionStorage.removeItem(
              AUTH_STORAGE_KEY
            );
          } catch (error) {
            console.warn(
              'Failed to clear stored Drive auth:',
              error
            );
          }
        },
        []
      );


    // ========================================================
    // LOAD GOOGLE GIS
    // ========================================================

    useEffect(() => {
      let cancelled = false;

      const initializeGoogle = async () => {
        try {
          await loadGoogleIdentityServices();

          if (cancelled) {
            return;
          }

          if (!window.google?.accounts?.oauth2) {
            return;
          }

          const tokenClient =
            window.google.accounts.oauth2
              .initTokenClient({
                client_id: googleClientId,

                scope: DRIVE_SCOPE,

                callback: (response) => {
                  const resolver =
                    connectionResolverRef.current;

                  connectionResolverRef.current =
                    null;

                  if (
                    response.error ||
                    !response.access_token
                  ) {
                    if (resolver) {
                      resolver(null);
                    }

                    return;
                  }

                  const expiresInSeconds =
                    Number(response.expires_in) > 0
                      ? Number(response.expires_in)
                      : 3600;

                  applyToken(
                    response.access_token,
                    Date.now() +
                      expiresInSeconds * 1000,
                    true
                  );

                  if (resolver) {
                    resolver(
                      response.access_token
                    );
                  }
                },

                error_callback: (error) => {
                  console.error(
                    'Google OAuth error:',
                    error
                  );

                  const resolver =
                    connectionResolverRef.current;

                  connectionResolverRef.current =
                    null;

                  if (resolver) {
                    resolver(null);
                  }
                },
              });

          tokenClientRef.current = tokenClient;

          setIsGoogleReady(true);
        } catch (error) {
          console.error(
            'Google Drive authentication initialization error:',
            error
          );
        }
      };

      initializeGoogle();

      return () => {
        cancelled = true;
      };
    }, [applyToken]);


    // ========================================================
    // RESTORE AUTH
    // ========================================================

    useEffect(() => {
      try {
        const authData =
          sessionStorage.getItem(
            AUTH_STORAGE_KEY
          );

        if (!authData) {
          return;
        }

        const parsed = JSON.parse(authData);

        const token = parsed?.token;
        const expiresAt = parsed?.expiresAt;

        if (
          typeof token === 'string' &&
          token &&
          typeof expiresAt === 'number' &&
          Date.now() <
            expiresAt - TOKEN_EXPIRY_MARGIN_MS
        ) {
          applyToken(token, expiresAt, false);
        } else {
          void clearAuth();
        }
      } catch (error) {
        console.warn(
          'Failed to restore Google Drive auth:',
          error
        );

        void clearAuth();
      }
    }, [applyToken, clearAuth]);


    // ========================================================
    // CONNECT DRIVE
    // ========================================================
    //
    // IMPORTANT: this must be called directly from a user
    // action (a tap) so the browser allows the Google popup.
    // If a token is already valid, no popup is shown.
    //
    // ========================================================

    const connectDrive =
      useCallback(
        async (): Promise<string | null> => {

          if (hasValidToken()) {
            return tokenRef.current;
          }

          // A request is already in flight: share it
          // instead of opening a second popup.
          if (connectPromiseRef.current) {
            return connectPromiseRef.current;
          }

          if (!tokenClientRef.current) {
            try {
              await loadGoogleIdentityServices();
            } catch (error) {
              console.error(
                'Unable to load Google authentication:',
                error
              );

              return null;
            }
          }

          if (!tokenClientRef.current) {
            return null;
          }

          setIsConnecting(true);

          const promise =
            new Promise<string | null>(
              (resolve) => {
                connectionResolverRef.current =
                  resolve;

                try {
                  // Empty prompt: Google only shows the
                  // consent screen when it is actually
                  // needed, not on every new session.
                  tokenClientRef.current?.requestAccessToken(
                    { prompt: '' }
                  );
                } catch (error) {
                  connectionResolverRef.current =
                    null;

                  console.error(
                    'Google Drive permission request failed:',
                    error
                  );

                  resolve(null);
                }
              }
            ).finally(() => {
              connectPromiseRef.current = null;
              setIsConnecting(false);
            });

          connectPromiseRef.current = promise;

          return promise;
        },
        [hasValidToken]
      );


    // ========================================================
    // GET VALID ACCESS TOKEN
    // ========================================================

    const getValidAccessToken =
      useCallback(
        async (): Promise<string | null> => {
          if (hasValidToken()) {
            return tokenRef.current;
          }

          return connectDrive();
        },
        [hasValidToken, connectDrive]
      );


    // ========================================================
    // RUN A DRIVE CALL WITH A VALID TOKEN
    // ========================================================
    //
    // If Google answers 401 the token is no longer good, so
    // it is cleared and the next call asks for a new one.
    //
    // ========================================================

    const withToken =
      useCallback(
        async <T>(
          run: (token: string) => Promise<T>
        ): Promise<T> => {
          const token =
            await getValidAccessToken();

          if (!token) {
            throw new Error(
              'Google Drive is not connected.'
            );
          }

          try {
            return await run(token);
          } catch (error) {
            if (
              error instanceof DriveError &&
              error.status === 401
            ) {
              void clearAuth();

              throw new Error(
                'Your Google Drive session expired. Please reconnect and try again.'
              );
            }

            throw error;
          }
        },
        [getValidAccessToken, clearAuth]
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
            const response = await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                fileId
              )}?alt=media`,
              {
                headers: getAuthHeader(token),
              }
            );

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
