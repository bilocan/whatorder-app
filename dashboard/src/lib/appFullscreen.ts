type PrefixedFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

function prefixedDocument(): PrefixedFullscreenDocument {
  return document as PrefixedFullscreenDocument;
}

/** Leaves Fullscreen API mode before the Windows program minimizes the PWA window. */
export async function leaveFullscreen(): Promise<void> {
  const doc = prefixedDocument();
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
      return;
    }
    if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    }
  } catch {
    // The local program still minimizes the window.
  }
}
