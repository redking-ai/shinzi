export const GoogleStickerIcon = ({ size = 28, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={{ display: 'block' }}
  >
    <path d="M18.5 2H5.5C3.57 2 2 3.57 2 5.5v13C2 20.43 3.57 22 5.5 22h7c.4 0 .78-.16 1.06-.44l7-7c.28-.28.44-.66.44-1.06v-8C21 3.57 19.43 2 18.5 2zm-5 18H5.5c-.83 0-1.5-.67-1.5-1.5v-13c0-.83.67-1.5 1.5-1.5h13c.83 0 1.5.67 1.5 1.5v7h-5c-.83 0-1.5.67-1.5 1.5v6zm2-5.5h3.09l-3.09 3.09v-3.09z" />
  </svg>
);

export const GoogleDownloadIcon = ({ size = 18, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={{ display: 'block' }}
  >
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
  </svg>
);

export const GooglePlayIcon = ({ size = 26, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={{ display: 'block' }}
  >
    <path d="M8 5v14l11-7z" />
  </svg>
);

export const GoogleFileIcon = ({ size = 24, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={{ display: 'block' }}
  >
    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
  </svg>
);
