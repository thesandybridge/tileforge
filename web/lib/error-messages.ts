/**
 * Maps technical error messages to user-friendly messages with recovery suggestions.
 */

export interface FriendlyError {
  title: string;
  message: string;
  suggestion?: string;
  technical?: string;
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  friendly: Omit<FriendlyError, "technical">;
}> = [
  // Memory errors
  {
    pattern: /memory|out of memory|oom|allocation failed|heap/i,
    friendly: {
      title: "Out of Memory",
      message: "This image is too large to process in your browser.",
      suggestion: "Try reducing the image dimensions, lowering the max zoom level, or use Server mode (Pro) for large images.",
    },
  },
  {
    pattern: /memory access out of bounds|unreachable|wasm trap/i,
    friendly: {
      title: "Processing Failed",
      message: "The image couldn't be processed due to memory constraints.",
      suggestion: "Try a smaller image or reduce the max zoom level. Server mode handles larger images better.",
    },
  },
  // Image decoding errors
  {
    pattern: /decode|decoding|invalid image|unsupported format|corrupt/i,
    friendly: {
      title: "Invalid Image",
      message: "The file couldn't be read as a valid image.",
      suggestion: "Make sure the file is a valid PNG, JPEG, or WebP image. Try opening it in an image editor and re-saving it.",
    },
  },
  {
    pattern: /unsupported|not supported/i,
    friendly: {
      title: "Unsupported Format",
      message: "This image format isn't supported.",
      suggestion: "Convert the image to PNG, JPEG, or WebP format and try again.",
    },
  },
  // WASM initialization errors
  {
    pattern: /wasm init|wasm.*failed|module.*initialized|instantiate/i,
    friendly: {
      title: "Engine Failed to Load",
      message: "The tile processing engine couldn't start.",
      suggestion: "Try refreshing the page. If the problem persists, your browser may not support WebAssembly.",
    },
  },
  // Network errors
  {
    pattern: /network|fetch|failed to fetch|connection|offline/i,
    friendly: {
      title: "Connection Error",
      message: "Couldn't connect to the server.",
      suggestion: "Check your internet connection and try again. You can also use Local mode which works offline.",
    },
  },
  {
    pattern: /timeout|timed out/i,
    friendly: {
      title: "Request Timed Out",
      message: "The operation took too long to complete.",
      suggestion: "Try again with a smaller image or lower zoom levels.",
    },
  },
  // Server errors
  {
    pattern: /server.*unavailable|503|502|504/i,
    friendly: {
      title: "Server Unavailable",
      message: "The processing server is temporarily unavailable.",
      suggestion: "Try again in a few moments, or switch to Local mode for browser-based processing.",
    },
  },
  {
    pattern: /rate limit|too many requests|429/i,
    friendly: {
      title: "Rate Limited",
      message: "You've made too many requests. Please wait a moment.",
      suggestion: "Wait a minute before trying again. Pro users have higher rate limits.",
    },
  },
  {
    pattern: /unauthorized|401|forbidden|403/i,
    friendly: {
      title: "Access Denied",
      message: "You don't have permission for this action.",
      suggestion: "Make sure you're signed in. Some features require a Pro subscription.",
    },
  },
  // Storage errors
  {
    pattern: /quota|storage.*full|disk.*space/i,
    friendly: {
      title: "Storage Full",
      message: "There's not enough storage space available.",
      suggestion: "Delete some existing tilesets to free up space, or upgrade to Pro for more storage.",
    },
  },
  // Download errors
  {
    pattern: /download failed|failed.*download/i,
    friendly: {
      title: "Download Failed",
      message: "Couldn't download the processed tiles.",
      suggestion: "Check your internet connection and try again.",
    },
  },
  // Lost connection
  {
    pattern: /lost connection|connection.*lost|disconnected/i,
    friendly: {
      title: "Connection Lost",
      message: "The connection to the server was interrupted.",
      suggestion: "Check your internet connection and try again.",
    },
  },
];

/**
 * Convert a technical error message to a user-friendly error.
 */
export function toFriendlyError(error: string | Error): FriendlyError {
  const message = typeof error === "string" ? error : error.message;

  for (const { pattern, friendly } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return {
        ...friendly,
        technical: message,
      };
    }
  }

  // Default fallback for unrecognized errors
  return {
    title: "Something Went Wrong",
    message: "An unexpected error occurred during processing.",
    suggestion: "Try again. If the problem persists, try refreshing the page or using a different image.",
    technical: message,
  };
}

/**
 * Check if an error is recoverable (user can retry).
 */
export function isRecoverableError(error: string | Error): boolean {
  const message = typeof error === "string" ? error : error.message;

  // These errors are typically not recoverable without user action
  const nonRecoverable = [
    /unsupported/i,
    /invalid image/i,
    /corrupt/i,
  ];

  return !nonRecoverable.some((pattern) => pattern.test(message));
}
