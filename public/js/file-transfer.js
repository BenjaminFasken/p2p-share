/**
 * file-transfer.js – Chunked file transfer over WebRTC DataChannels.
 *
 * Protocol (over the DataChannel):
 *   Control messages are JSON strings.
 *   File data is sent as ArrayBuffer chunks.
 *
 * Sender flow:
 *   1. Send JSON  { cmd: "file-start", name, size, type, fileIndex, totalFiles }
 *   2. Send binary chunks (default 64 KB each)
 *   3. Send JSON  { cmd: "file-end", fileIndex }
 *   4. Repeat for each file
 *   5. Send JSON  { cmd: "transfer-complete" }
 *
 * Receiver flow:
 *   Listens for the above and reassembles files, emitting progress events.
 */
class FileTransfer {
  constructor() {
    this.CHUNK_SIZE = 64 * 1024; // 64 KB – safe for most DataChannel impls
    this._handlers = {};
  }

  on(event, fn) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  }

  _emit(event, ...args) {
    (this._handlers[event] || []).forEach(fn => fn(...args));
  }

  /**
   * Send files over a DataChannel.
   * @param {RTCDataChannel} dc
   * @param {File[]} files
   */
  async sendFiles(dc, files) {
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    let sentBytes = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Announce file start
      dc.send(JSON.stringify({
        cmd: 'file-start',
        name: file.name,
        size: file.size,
        type: file.type,
        fileIndex: i,
        totalFiles: files.length,
      }));

      // Read and send chunks
      let offset = 0;
      const reader = file.stream().getReader();
      let leftover = new Uint8Array(0);

      while (true) {
        const { done, value } = await reader.read();
        if (done && leftover.length === 0) break;

        let data = leftover;
        if (value) {
          // Merge leftover + new value
          const merged = new Uint8Array(leftover.length + value.length);
          merged.set(leftover);
          merged.set(value, leftover.length);
          data = merged;
        }

        let pos = 0;
        while (pos + this.CHUNK_SIZE <= data.length) {
          const chunk = data.slice(pos, pos + this.CHUNK_SIZE);
          await this._sendChunk(dc, chunk.buffer);
          pos += this.CHUNK_SIZE;
          sentBytes += this.CHUNK_SIZE;
          offset += this.CHUNK_SIZE;
          this._emit('send-progress', { sentBytes, totalBytes, fileName: file.name });
        }
        leftover = data.slice(pos);

        if (done && leftover.length > 0) {
          await this._sendChunk(dc, leftover.buffer);
          sentBytes += leftover.length;
          offset += leftover.length;
          leftover = new Uint8Array(0);
          this._emit('send-progress', { sentBytes, totalBytes, fileName: file.name });
        }
      }

      dc.send(JSON.stringify({ cmd: 'file-end', fileIndex: i }));
    }

    dc.send(JSON.stringify({ cmd: 'transfer-complete' }));
    this._emit('send-complete');
  }

  /**
   * Send a single chunk, pausing if the buffer is full.
   */
  _sendChunk(dc, buffer) {
    return new Promise((resolve) => {
      const LOW_WATER = 256 * 1024;
      if (dc.bufferedAmount > LOW_WATER) {
        const check = () => {
          if (dc.bufferedAmount <= LOW_WATER) {
            dc.removeEventListener('bufferedamountlow', check);
            dc.send(buffer);
            resolve();
          }
        };
        dc.bufferedAmountLowThreshold = LOW_WATER;
        dc.addEventListener('bufferedamountlow', check);
      } else {
        dc.send(buffer);
        resolve();
      }
    });
  }

  /**
   * Create a receiver that listens on a DataChannel.
   * Returns a ReceiveSession.
   */
  createReceiver() {
    return new ReceiveSession(this);
  }
}


/**
 * Handles the receive side: accumulates chunks, emits progress,
 * triggers download when files are complete.
 */
class ReceiveSession {
  constructor(ft) {
    this._ft = ft;
    this._currentFile = null;
    this._chunks = [];
    this._received = 0;
    this._totalBytes = 0;
    this._filesCompleted = [];
  }

  /** Call this with every DataChannel message (string or ArrayBuffer) */
  onMessage(data) {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      switch (msg.cmd) {
        case 'file-start':
          this._currentFile = { name: msg.name, size: msg.size, type: msg.type, index: msg.fileIndex, totalFiles: msg.totalFiles };
          this._totalBytes += msg.size;
          this._chunks = [];
          this._received = 0;
          break;
        case 'file-end':
          this._saveFile();
          break;
        case 'transfer-complete':
          this._ft._emit('receive-complete', this._filesCompleted);
          break;
      }
    } else {
      // Binary chunk
      this._chunks.push(data);
      this._received += data.byteLength;
      this._ft._emit('receive-progress', {
        receivedBytes: this._received,
        totalBytes: this._currentFile ? this._currentFile.size : 0,
        fileName: this._currentFile ? this._currentFile.name : '',
      });
    }
  }

  _saveFile() {
    if (!this._currentFile) return;
    const blob = new Blob(this._chunks, { type: this._currentFile.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = this._currentFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    this._filesCompleted.push({ name: this._currentFile.name, size: this._currentFile.size });
    this._currentFile = null;
    this._chunks = [];
    this._received = 0;
  }
}
