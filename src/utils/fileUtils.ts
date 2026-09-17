/**
 * File utilities for viewing, previewing, and opening dental case attachments & photos in the browser.
 */

export const openFileInBrowser = (
  fileUrl: string,
  filename: string = 'document',
  fileType: string = 'application/octet-stream'
) => {
  if (!fileUrl) return;

  try {
    // If it's already a standard http/https web link or blob URL
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://') || fileUrl.startsWith('blob:')) {
      const newWin = window.open(fileUrl, '_blank', 'noopener,noreferrer');
      if (!newWin) {
        const link = document.createElement('a');
        link.href = fileUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      return;
    }

    // If it's a data URL (e.g. data:image/jpeg;base64,... or data:application/pdf;base64,...)
    if (fileUrl.startsWith('data:')) {
      const parts = fileUrl.split(',');
      const meta = parts[0];
      const base64Data = parts[1];
      const mimeMatch = meta.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : fileType;

      // Decode base64 to binary byte array
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mime });
      const blobUrl = URL.createObjectURL(blob);

      // Open Blob URL in a new browser tab
      const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!win) {
        // Fallback if popup blocker intercepted
        const link = document.createElement('a');
        link.href = blobUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      return;
    }

    // Generic fallback
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.warn('Unable to open file in browser tab directly:', err);
    // As a safe fallback, trigger download or open direct link
    const link = document.createElement('a');
    link.href = fileUrl;
    link.target = '_blank';
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};
