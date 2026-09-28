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
  localUri: string;
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
    const data =
      await response.json();

    if (
      data?.error?.message
    ) {
      message =
        data.error.message;
    }
  } catch {
    // Ignore JSON parsing failure.
  }

  throw new Error(
    `Google Drive error (${response.status}): ${message}`
  );
};


// ============================================================
// GOOGLE IDENTITY SERVICES SCRIPT
// ============================================================

let googleScriptPromise:
  Promise<void> | null = null;


const loadGoogleIdentityServices =
  (): Promise<void> => {
    if (
      typeof window === 'undefined'
    ) {
      return Promise.reject(
        new Error(
          'Google Drive authentication is only available in a browser.'
        )
      );
    }

    if (
      window.google?.accounts?.oauth2
    ) {
      return Promise.resolve();
    }

    if (googleScriptPromise) {
      return googleScriptPromise;
    }

    googleScriptPromise =
      new Promise<void>(
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
            document.createElement(
              'script'
            );

          script.src =
            'https://accounts.google.com/gsi/client';

          script.async = true;
          script.defer = true;

          script.dataset.shinziGoogleGis =
            'true';

          script.onload = () => {
            if (
              window.google?.accounts?.oauth2
            ) {
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
            reject(
              new Error(
                'Unable to load Google authentication.'
              )
            );
          };

          document.head.appendChild(
            script
          );
        }
      );

    return googleScriptPromise;
  };


// ============================================================
// GOOGLE DRIVE STORE
// ============================================================

export const useDriveStore =
  (): DriveStore => {

    const [
      accessToken,
      setAccessToken,
    ] = useState<string | null>(
      null
    );

    const [
      isLocallyValid,
      setIsLocallyValid,
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
      useRef<GoogleTokenClient | null>(
        null
      );

    const connectionResolverRef =
      useRef<
        ((token: string | null) => void) | null
      >(null);


    // ========================================================
    // LOAD GOOGLE GIS
    // ========================================================

    useEffect(() => {
      let cancelled = false;

      const initializeGoogle =
        async () => {
          try {
            await loadGoogleIdentityServices();

            if (cancelled) {
              return;
            }

            if (
              !window.google?.accounts?.oauth2
            ) {
              return;
            }

            const tokenClient =
              window.google.accounts.oauth2
                .initTokenClient({
                  client_id:
                    googleClientId,

                  scope:
                    DRIVE_SCOPE,

                  callback:
                    (
                      response
                    ) => {
                      const resolver =
                        connectionResolverRef
                          .current;

                      connectionResolverRef
                        .current = null;

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
                        Number(
                          response.expires_in
                        ) > 0
                          ? Number(
                              response.expires_in
                            )
                          : 3600;

                      const expiresAt =
                        Date.now() +
                        expiresInSeconds *
                          1000;

                      setAccessToken(
                        response.access_token
                      );

                      setIsLocallyValid(
                        true
                      );

                      try {
                        sessionStorage.setItem(
                          AUTH_STORAGE_KEY,
                          JSON.stringify({
                            token:
                              response.access_token,

                            expiresAt,
                          })
                        );
                      } catch (
                        storageError
                      ) {
                        console.warn(
                          'Failed to store Drive session:',
                          storageError
                        );
                      }

                      if (resolver) {
                        resolver(
                          response.access_token
                        );
                      }
                    },

                  error_callback:
                    (error) => {
                      console.error(
                        'Google OAuth error:',
                        error
                      );

                      const resolver =
                        connectionResolverRef
                          .current;

                      connectionResolverRef
                        .current = null;

                      if (resolver) {
                        resolver(null);
                      }
                    },
                });

            tokenClientRef.current =
              tokenClient;

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
    }, []);


    // ========================================================
    // CLEAR AUTH
    // ========================================================

    const clearAuth =
      useCallback(
        async (): Promise<void> => {
          setAccessToken(null);

          setIsLocallyValid(false);

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
    // RESTORE AUTH
    // ========================================================

    useEffect(() => {
      const hydrateAuth =
        async () => {
          try {
            const authData =
              sessionStorage.getItem(
                AUTH_STORAGE_KEY
              );

            if (!authData) {
              return;
            }

            const parsed =
              JSON.parse(
                authData
              );

            const token =
              parsed?.token;

            const expiresAt =
              parsed?.expiresAt;

            if (
              token &&
              expiresAt &&
              Date.now() < expiresAt
            ) {
              setAccessToken(
                token
              );

              setIsLocallyValid(
                true
              );
            } else {
              await clearAuth();
            }
          } catch (error) {
            console.warn(
              'Failed to restore Google Drive auth:',
              error
            );

            await clearAuth();
          }
        };

      hydrateAuth();
    }, [clearAuth]);


    // ========================================================
    // CONNECT DRIVE
    // ========================================================

    const connectDrive =
      useCallback(
        async (): Promise<string | null> => {

          if (isConnecting) {
            return null;
          }

          if (
            accessToken &&
            isLocallyValid
          ) {
            return accessToken;
          }

          if (
            !tokenClientRef.current
          ) {
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

          if (
            !tokenClientRef.current
          ) {
            return null;
          }

          setIsConnecting(true);

          try {
            const token =
              await new Promise<
                string | null
              >(
                (
                  resolve
                ) => {

                  connectionResolverRef
                    .current = resolve;

                  try {
                    tokenClientRef.current?.requestAccessToken(
                      {
                        prompt:
                          'consent',
                      }
                    );
                  } catch (error) {

                    connectionResolverRef
                      .current = null;

                    console.error(
                      'Google Drive permission request failed:',
                      error
                    );

                    resolve(
                      null
                    );
                  }
                }
              );

            return token;

          } finally {
            setIsConnecting(
              false
            );
          }
        },
        [
          accessToken,
          isLocallyValid,
          isConnecting,
        ]
      );


    // ========================================================
    // GET VALID ACCESS TOKEN
    // ========================================================

    const getValidAccessToken =
      useCallback(
        async (): Promise<string | null> => {

          if (
            accessToken &&
            isLocallyValid
          ) {
            return accessToken;
          }

          return connectDrive();
        },
        [
          accessToken,
          isLocallyValid,
          connectDrive,
        ]
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
            `?q=${encodeURIComponent(
              query
            )}` +
            `&spaces=drive` +
            `&pageSize=1` +
            `&fields=files(id,name,mimeType,parents)`;

          const response =
            await fetch(
              url,
              {
                headers:
                  getAuthHeader(
                    token
                  ),
              }
            );

          await throwDriveError(
            response,
            'Unable to search Google Drive folders.'
          );

          const data =
            await response.json();

          return (
            data?.files?.[0] ||
            null
          );
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
            body.parents = [
              parentId,
            ];
          }

          const response =
            await fetch(
              `${DRIVE_API}/files?fields=id,name,mimeType,parents`,
              {
                method: 'POST',

                headers: {
                  ...getAuthHeader(
                    token
                  ),

                  'Content-Type':
                    'application/json',
                },

                body:
                  JSON.stringify(
                    body
                  ),
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

          const existing =
            await findFolder(
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
        [
          findFolder,
          createFolder,
        ]
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
        [
          getOrCreateFolder,
        ]
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
            SHINZI_SUBFOLDERS[
              folderType
            ];

          if (!folderName) {
            throw new Error(
              `Unknown Shinzi folder type: ${folderType}`
            );
          }

          const root =
            await getShinziFolder(
              token
            );

          return getOrCreateFolder(
            token,
            folderName,
            root.id
          );
        },
        [
          getShinziFolder,
          getOrCreateFolder,
        ]
      );


    // ========================================================
    // UPLOAD FILE
    // ========================================================

    const uploadFile =
      useCallback(
        async ({
          localUri,
          fileName,
          mimeType,
          folderType = 'others',
        }: UploadFileOptions): Promise<UploadedDriveFile> => {

          if (!localUri) {
            throw new Error(
              'A local file URI is required.'
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

          const token =
            await getValidAccessToken();

          if (!token) {
            throw new Error(
              'Google Drive is not connected.'
            );
          }

          const folder =
            await getShinziSubfolder(
              token,
              folderType
            );

          const localResponse =
            await fetch(
              localUri
            );

          if (!localResponse.ok) {
            throw new Error(
              'Unable to read the selected local file.'
            );
          }

          const fileBlob =
            await localResponse.blob();

          if (!fileBlob) {
            throw new Error(
              'The selected file could not be converted into upload data.'
            );
          }

          const uploadResponse =
            await fetch(
              `${DRIVE_UPLOAD_API}/files?uploadType=media&fields=id,name,mimeType,size,parents`,
              {
                method: 'POST',

                headers: {
                  ...getAuthHeader(
                    token
                  ),

                  'Content-Type':
                    mimeType,
                },

                body: fileBlob,
              }
            );

          await throwDriveError(
            uploadResponse,
            'Unable to upload file to Google Drive.'
          );

          const uploaded =
            await uploadResponse.json();

          if (!uploaded?.id) {
            throw new Error(
              'Google Drive upload completed without returning a file ID.'
            );
          }

          const updateResponse =
            await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                uploaded.id
              )}` +
                `?addParents=${encodeURIComponent(
                  folder.id
                )}` +
                `&fields=id,name,mimeType,size,parents`,
              {
                method: 'PATCH',

                headers: {
                  ...getAuthHeader(
                    token
                  ),

                  'Content-Type':
                    'application/json',
                },

                body:
                  JSON.stringify({
                    name: fileName,
                  }),
              }
            );

          await throwDriveError(
            updateResponse,
            'File uploaded but could not be organized inside the Shinzi folder.'
          );

          const finalFile =
            await updateResponse.json();

          return {
            fileId:
              finalFile.id,

            folderId:
              folder.id,

            fileName:
              finalFile.name ||
              fileName,

            mimeType:
              finalFile.mimeType ||
              mimeType,

            sizeBytes:
              finalFile.size
                ? Number(
                    finalFile.size
                  )
                : fileBlob.size,
          };
        },
        [
          getValidAccessToken,
          getShinziSubfolder,
        ]
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

          if (
            typeof text !==
            'string'
          ) {
            throw new Error(
              'Text content must be a string.'
            );
          }

          if (!fileName) {
            throw new Error(
              'A file name is required.'
            );
          }

          const token =
            await getValidAccessToken();

          if (!token) {
            throw new Error(
              'Google Drive is not connected.'
            );
          }

          const folder =
            await getShinziSubfolder(
              token,
              folderType
            );

          const textBlob =
            new Blob(
              [text],
              {
                type:
                  'text/plain; charset=utf-8',
              }
            );

          const uploadResponse =
            await fetch(
              `${DRIVE_UPLOAD_API}/files?uploadType=media&fields=id,name,mimeType,size,parents`,
              {
                method: 'POST',

                headers: {
                  ...getAuthHeader(
                    token
                  ),

                  'Content-Type':
                    'text/plain; charset=utf-8',
                },

                body: textBlob,
              }
            );

          await throwDriveError(
            uploadResponse,
            'Unable to create text file in Google Drive.'
          );

          const uploaded =
            await uploadResponse.json();

          if (!uploaded?.id) {
            throw new Error(
              'Google Drive text upload completed without returning a file ID.'
            );
          }

          const updateResponse =
            await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                uploaded.id
              )}` +
                `?addParents=${encodeURIComponent(
                  folder.id
                )}` +
                `&fields=id,name,mimeType,size,parents`,
              {
                method: 'PATCH',

                headers: {
                  ...getAuthHeader(
                    token
                  ),

                  'Content-Type':
                    'application/json',
                },

                body:
                  JSON.stringify({
                    name: fileName,
                  }),
              }
            );

          await throwDriveError(
            updateResponse,
            'Text file was created but could not be organized inside the Shinzi folder.'
          );

          const finalFile =
            await updateResponse.json();

          return {
            fileId:
              finalFile.id,

            folderId:
              folder.id,

            fileName:
              finalFile.name ||
              fileName,

            mimeType:
              finalFile.mimeType ||
              'text/plain',

            sizeBytes:
              finalFile.size
                ? Number(
                    finalFile.size
                  )
                : textBlob.size,
          };
        },
        [
          getValidAccessToken,
          getShinziSubfolder,
        ]
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

          const token =
            await getValidAccessToken();

          if (!token) {
            throw new Error(
              'Google Drive is not connected.'
            );
          }

          const response =
            await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                fileId
              )}` +
                `?fields=id,name,mimeType,size,parents,trashed`,
              {
                headers:
                  getAuthHeader(
                    token
                  ),
              }
            );

          await throwDriveError(
            response,
            'Unable to retrieve Google Drive file metadata.'
          );

          return response.json();
        },
        [
          getValidAccessToken,
        ]
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

          const token =
            await getValidAccessToken();

          if (!token) {
            throw new Error(
              'Google Drive is not connected.'
            );
          }

          const response =
            await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                fileId
              )}?alt=media`,
              {
                headers:
                  getAuthHeader(
                    token
                  ),
              }
            );

          await throwDriveError(
            response,
            'Unable to download Google Drive file.'
          );

          const blob =
            await response.blob();

          if (!blob) {
            throw new Error(
              'Google Drive returned empty file data.'
            );
          }

          return new Promise<string>(
            (
              resolve,
              reject
            ) => {

              const reader =
                new FileReader();

              reader.onloadend =
                () => {

                  if (
                    typeof reader.result !==
                    'string'
                  ) {
                    reject(
                      new Error(
                        'Unable to convert Drive file into image data.'
                      )
                    );

                    return;
                  }

                  resolve(
                    reader.result
                  );
                };

              reader.onerror =
                () => {
                  reject(
                    new Error(
                      'Failed to read downloaded Drive file.'
                    )
                  );
                };

              reader.readAsDataURL(
                blob
              );
            }
          );
        },
        [
          getValidAccessToken,
        ]
      );


    // ========================================================
    // DELETE FILE
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

          const token =
            await getValidAccessToken();

          if (!token) {
            throw new Error(
              'Google Drive is not connected.'
            );
          }

          const response =
            await fetch(
              `${DRIVE_API}/files/${encodeURIComponent(
                fileId
              )}`,
              {
                method: 'DELETE',

                headers:
                  getAuthHeader(
                    token
                  ),
              }
            );

          await throwDriveError(
            response,
            'Unable to delete Google Drive file.'
          );

          return true;
        },
        [
          getValidAccessToken,
        ]
      );


    // ========================================================
    // RETURN STORE API
    // ========================================================

    return {
      isReady:
        isGoogleReady,

      hasActiveSession:
        isLocallyValid,

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
